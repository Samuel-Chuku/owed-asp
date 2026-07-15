// Blackbox MCP server — the ASP surface (§6). Fastify host, MCP streamable
// HTTP transport in stateless mode (new transport per request, no sessions).
//
//   npx tsx src/server/index.ts          # PORT=8402 by default
//
// Tools (v1): royalty_quick_check ($1) · royalty_leak_scan ($5, async →
// scanId) · scan_status (free). Estimation detail + claim kit tools land
// next. Paid tools pass through the x402 gate (PAYMENT_MODE=off until the
// ASP wallet is registered).

import Fastify from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { defaultMlcClient, runScan } from '../pipeline/scan.js';
import { searchArtistCandidates } from '../identity/index.js';
import { JobStore } from './jobs.js';
import { gatePaidCall, paymentConfigFromEnv, PRICES_USD, type PaidTool } from './payment.js';
import { renderReportHtml } from './report.js';
import { renderKitHtml } from './kit-page.js';
import { generateClaimKit } from '../claim-kit/index.js';

const ROOT = join(import.meta.dirname, '..', '..');
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  // no .env — env comes from the shell (PM2/CI)
}
const PORT = Number(process.env.PORT ?? 8402);
const BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;

const jobs = new JobStore(join(ROOT, 'data', 'jobs'));
const mlcClient = defaultMlcClient(ROOT);
const paymentCfg = paymentConfigFromEnv();

const DISCLAIMER =
  'Owed is not affiliated with The MLC. Share percentages are publicly verifiable at the cited source URLs; joining The MLC and claiming is free. Dollar figures, when present, are estimates with the method stated.';

// ---- background scan worker (in-process; PM2 keeps it alive on the VPS) ----

async function executeScan(scanId: string): Promise<void> {
  const job = jobs.get(scanId);
  if (!job) return;
  job.status = 'running';
  jobs.update(job);
  try {
    const result = await runScan(job.artistQuery, {
      client: mlcClient,
      youtubeApiKey: process.env.YOUTUBE_API_KEY,
      youtubeCacheDir: join(ROOT, 'data', 'cache'),
      onProgress: (m) => {
        job.progress.push(`${new Date().toISOString()} ${m}`);
        jobs.update(job);
      },
    });
    job.status = 'complete';
    job.result = result;
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
  }
  jobs.update(job);
}

// ---- MCP server factory (stateless: fresh instance per request) ----

function buildMcpServer(paymentHeader: string | undefined): McpServer {
  const server = new McpServer({ name: 'owed-royalty-scanner', version: '0.1.0' });

  // Paid-tool wrapper: consult the x402 gate before doing any work. In MCP,
  // gate failures surface as isError content with the 402 challenge attached
  // so agent clients (per the x402 spec) can pay and retry.
  const gated = (tool: PaidTool, handler: (args: any) => Promise<any>) => {
    return async (args: any) => {
      const gate = await gatePaidCall(tool, paymentCfg, paymentHeader);
      if (!gate.ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ httpStatus: gate.httpStatus, ...((gate.body as object) ?? {}), paymentHeaders: gate.headers }),
            },
          ],
        };
      }
      return handler(args);
    };
  };

  server.registerTool(
    'royalty_quick_check',
    {
      title: 'Royalty quick check',
      description:
        `Quick leak check for an artist ($${PRICES_USD.royalty_quick_check}). Resolves the artist identity, samples their catalog against The MLC public database, and returns identity candidates, counts of registered works found, a leak-score preview, and gap counts by kind — no per-work details, estimates, or evidence (those come from royalty_leak_scan). ${DISCLAIMER}`,
      inputSchema: { artistName: z.string().min(1).describe('Artist stage name, e.g. "Shallipopi"') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    gated('royalty_quick_check', async ({ artistName }: { artistName: string }) => {
      // Sampled scan: few titles, cheap but honest.
      const result = await runScan(artistName, { client: mlcClient, maxTracks: 5 });
      if (result.status !== 'complete') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as any,
        };
      }
      const byKind: Record<string, number> = {};
      for (const g of result.gaps) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;
      const summary = {
        status: 'complete',
        artist: result.artist.resolvedName,
        aliases: result.artist.aliases,
        sampledTracks: result.artist.tracks.length,
        registeredWorksVerified: result.works.length,
        gapsExist: result.gaps.length > 0,
        gapCountsByKind: byKind,
        leakScorePreview: result.leakScore,
        note: `Sampled check over ${result.artist.tracks.length} tracks. Run royalty_leak_scan for the full catalog, per-work details, evidence URLs, and estimates.`,
        disclaimer: DISCLAIMER,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary as any,
      };
    }),
  );

  server.registerTool(
    'royalty_leak_scan',
    {
      title: 'Full royalty leak scan',
      description:
        `Full-catalog royalty leak scan ($${PRICES_USD.royalty_leak_scan}). Returns a scanId immediately; the crawl takes 2–10 minutes (respectful rate limits against public registries) — poll scan_status. The completed report contains ISRC-verified works, deterministic gap findings with evidence URLs, and a leak score. Scans are cached 24h per artist. ${DISCLAIMER}`,
      inputSchema: { artistName: z.string().min(1).describe('Artist stage name') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    gated('royalty_leak_scan', async ({ artistName }: { artistName: string }) => {
      const cached = jobs.findRecentComplete(artistName);
      if (cached) {
        const payload = { scanId: cached.scanId, status: 'complete', cached: true };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload as any,
        };
      }
      const job = jobs.create(artistName);
      void executeScan(job.scanId);
      const payload = {
        scanId: job.scanId,
        status: 'queued',
        note: 'Poll scan_status with this scanId; typical completion 2–10 minutes.',
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload as any,
      };
    }),
  );

  server.registerTool(
    'claim_kit_generate',
    {
      title: 'Generate claim kit',
      description:
        `Personalized claim kit from a completed scan ($${PRICES_USD.claim_kit_generate}). Turns the leak report into an ordered fix plan: MLC membership guidance, exact works and shares to claim, works to register (with ISRCs), IPI/PRO steps, W-8BEN pointers for non-US claimants, a checklist, and realistic timelines. Returns the structured kit plus a hosted page URL. Educational guidance, not legal advice. ${DISCLAIMER}`,
      inputSchema: { scanId: z.string().uuid().describe('scanId of a completed royalty_leak_scan') },
      annotations: { readOnlyHint: true },
    },
    gated('claim_kit_generate', async ({ scanId }: { scanId: string }) => {
      const job = jobs.get(scanId);
      if (!job || job.status !== 'complete' || job.result?.status !== 'complete') {
        const payload = {
          error: job ? 'scan_not_complete' : 'not_found',
          scanId,
          note: 'claim_kit_generate needs a completed scan. Run royalty_leak_scan first and poll scan_status.',
        };
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
      }
      const kit = generateClaimKit(job.result);
      const payload = { ...kit, kitUrl: `${BASE_URL}/k/${job.scanId}`, reportUrl: `${BASE_URL}/r/${job.scanId}` };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as any,
      };
    }),
  );

  server.registerTool(
    'scan_status',
    {
      title: 'Scan status',
      description:
        'Free. Poll a running scan by scanId. Returns status (queued/running/complete/error), progress log, and — when complete — the full leak report.',
      inputSchema: { scanId: z.string().uuid().describe('scanId returned by royalty_leak_scan') },
      annotations: { readOnlyHint: true },
    },
    async ({ scanId }: { scanId: string }) => {
      const job = jobs.get(scanId);
      const payload = job
        ? {
            scanId: job.scanId,
            status: job.status,
            progress: job.progress.slice(-5),
            ...(job.status === 'complete'
              ? { report: job.result, reportUrl: `${BASE_URL}/r/${job.scanId}` }
              : {}),
            ...(job.status === 'error' ? { error: job.error } : {}),
          }
        : { error: 'not_found', scanId };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as any,
      };
    },
  );

  return server;
}

// ---- Fastify host ----

async function main() {
  // trustProxy: X-Forwarded-For from the local nginx/Caddy front — without it
  // request.ip is 127.0.0.1 for every caller and the quick-check throttle
  // would rate-limit all users as one.
  const app = Fastify({ logger: true, trustProxy: true });

  app.get('/healthz', async () => ({ ok: true, service: 'owed-asp', paymentMode: paymentCfg.mode }));

  // Hosted report page — the shareable artifact (§5 step 6).
  app.get<{ Params: { scanId: string } }>('/r/:scanId', async (request, reply) => {
    const job = jobs.get(request.params.scanId);
    if (!job) return reply.code(404).type('text/html').send('<h1>Report not found</h1>');
    return reply.type('text/html').send(renderReportHtml(job, BASE_URL));
  });

  // Hosted claim-kit page (paid tool returns this URL; the page itself is
  // unguessable — scanIds are UUIDs — matching the report-page model).
  app.get<{ Params: { scanId: string } }>('/k/:scanId', async (request, reply) => {
    const job = jobs.get(request.params.scanId);
    if (!job || job.status !== 'complete' || job.result?.status !== 'complete') {
      return reply.code(404).type('text/html').send('<h1>Claim kit not found</h1>');
    }
    return reply.type('text/html').send(renderKitHtml(generateClaimKit(job.result), job.scanId));
  });

  // Free quick check for the marketing site (the $1 tool is the ASP surface;
  // the site's first check is free by the Jul 10 frontend decision — the
  // distribution hook). Cross-origin because the frontend lives on Vercel.
  const quickCheckLastByIp = new Map<string, number>();
  app.get<{ Querystring: { artist?: string } }>('/api/quick-check', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const artist = (request.query.artist ?? '').trim();
    if (!artist) return reply.code(400).send({ error: 'missing_artist' });
    const ip = request.ip;
    const last = quickCheckLastByIp.get(ip) ?? 0;
    if (Date.now() - last < 20_000) {
      return reply.code(429).send({ error: 'slow_down', note: 'One check per 20 seconds.' });
    }
    quickCheckLastByIp.set(ip, Date.now());
    try {
      const result = await runScan(artist, { client: mlcClient, maxTracks: 5 });
      if (result.status !== 'complete') return reply.send(result);
      const byKind: Record<string, number> = {};
      for (const g of result.gaps) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;
      return reply.send({
        status: 'complete',
        artist: result.artist.resolvedName,
        sampledTracks: result.artist.tracks.length,
        registeredWorksVerified: result.works.length,
        gapsExist: result.gaps.length > 0,
        criticalGaps: result.gaps.filter((g) => g.severity === 'critical').length,
        unregisteredTracks: byKind['work_not_registered'] ?? 0,
        leakScorePreview: result.leakScore,
      });
    } catch {
      return reply.code(502).send({ error: 'scan_failed' });
    }
  });

  // Captured evidence snapshots (non-negotiable 3): the raw registry
  // responses each report claim is based on, publicly verifiable.
  app.get<{ Params: { file: string } }>('/evidence/:file', async (request, reply) => {
    const name = request.params.file;
    if (!/^[\w.-]+\.json$/.test(name) || name.includes('..')) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    const path = join(ROOT, 'data', 'snapshots', name);
    if (!existsSync(path)) return reply.code(404).send({ error: 'not_found' });
    return reply.type('application/json').send(readFileSync(path, 'utf8'));
  });

  app.post('/mcp', async (request, reply) => {
    // Stateless mode: fresh server + transport per request, no session ids.
    const server = buildMcpServer(
      (request.headers['x-payment'] as string | undefined) ??
        (request.headers['payment-signature'] as string | undefined),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    request.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  // Stateless server: GET/DELETE (SSE sessions) are not offered.
  app.get('/mcp', async (_req, reply) =>
    reply.code(405).send({ error: 'stateless server: POST only' }),
  );

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Blackbox MCP server on :${PORT} (payment mode: ${paymentCfg.mode})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
