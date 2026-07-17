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
import { gateMcpHttp, gatePaidCall, paidToolForBody, paymentConfigFromEnv, PRICES_USD, type PaidTool } from './payment.js';
import { initX402Sdk, type SdkGate } from './payment-sdk.js';
import { renderReportHtml } from './report.js';
import { renderKitHtml } from './kit-page.js';
import { generateClaimKit } from '../claim-kit/index.js';
import type { ScanJob } from './jobs.js';

/** Filename fragment for ?download=1: artist slug when the scan completed, scanId prefix otherwise. */
function downloadSlug(job: ScanJob): string {
  const name = job.result?.status === 'complete' ? job.result.artist.resolvedName : '';
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || job.scanId.slice(0, 8);
}

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

function buildMcpServer(paymentHeader: string | undefined, demoBypass = false): McpServer {
  const server = new McpServer({ name: 'owed-royalty-scanner', version: '0.1.0' });

  // Paid-tool wrapper: consult the x402 gate before doing any work. In MCP,
  // gate failures surface as isError content with the 402 challenge attached
  // so agent clients (per the x402 spec) can pay and retry. Owner demo calls
  // (verified against PAYMENT_DEMO_KEY at the HTTP layer) skip the gate —
  // the HTTP layer is the only place the demo header is checked.
  const gated = (tool: PaidTool, handler: (args: any) => Promise<any>) => {
    return async (args: any) => {
      if (demoBypass) return handler(args);
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

let sdkGate: SdkGate | null = null;

async function main() {
  sdkGate = await initX402Sdk(paymentCfg).catch((err) => {
    console.error('x402 SDK init failed — falling back to challenge-only mode:', err?.message ?? err);
    return null;
  });
  if (paymentCfg.mode === 'x402') {
    console.log(`x402 mode: ${sdkGate ? 'SDK verification + settlement ACTIVE' : 'challenge-only (no Dev Portal keys — paid calls refused)'}`);
  }
  // trustProxy: X-Forwarded-For from the local nginx/Caddy front — without it
  // request.ip is 127.0.0.1 for every caller and the quick-check throttle
  // would rate-limit all users as one.
  const app = Fastify({ logger: true, trustProxy: true });

  // Lenient JSON parsing: the marketplace review probe is a bare
  // `curl -i -X POST <endpoint>` (no/invalid body) and must reach the x402
  // gate to receive its 402 — not die in the body parser with a 400/415.
  const lenientJson = (_req: unknown, body: string, done: (err: null, v: unknown) => void) => {
    try {
      done(null, body ? JSON.parse(body) : {});
    } catch {
      done(null, {});
    }
  };
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, lenientJson);
  app.addContentTypeParser('*', { parseAs: 'string' }, lenientJson);

  app.get('/healthz', async () => ({ ok: true, service: 'owed-asp', paymentMode: paymentCfg.mode }));

  // Free full-scan endpoints for the frontend (user decision, Jul 15: every
  // step on the site is free until deliberately gated; the paid surface is
  // the MCP/ASP side). Same job store and 24h cache as the paid tool.
  const siteScanLastByIp = new Map<string, number>();
  app.get<{ Querystring: { artist?: string } }>('/api/scan', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const artist = (request.query.artist ?? '').trim();
    if (!artist) return reply.code(400).send({ error: 'missing_artist' });
    const last = siteScanLastByIp.get(request.ip) ?? 0;
    if (Date.now() - last < 120_000) {
      return reply.code(429).send({ error: 'slow_down', note: 'One full scan per 2 minutes.' });
    }
    siteScanLastByIp.set(request.ip, Date.now());
    const cached = jobs.findRecentComplete(artist);
    if (cached) {
      return reply.send({
        scanId: cached.scanId,
        status: 'complete',
        cached: true,
        reportUrl: `${BASE_URL}/r/${cached.scanId}`,
        kitUrl: `${BASE_URL}/k/${cached.scanId}`,
      });
    }
    const job = jobs.create(artist);
    void executeScan(job.scanId);
    return reply.send({ scanId: job.scanId, status: 'queued' });
  });

  app.get<{ Params: { scanId: string } }>('/api/scan-status/:scanId', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const job = jobs.get(request.params.scanId);
    if (!job) return reply.code(404).send({ error: 'not_found' });
    return reply.send({
      scanId: job.scanId,
      status: job.status,
      progress: job.progress.slice(-3),
      ...(job.status === 'complete'
        ? { reportUrl: `${BASE_URL}/r/${job.scanId}`, kitUrl: `${BASE_URL}/k/${job.scanId}` }
        : {}),
      ...(job.status === 'error' ? { error: job.error } : {}),
    });
  });

  // Hosted report page — the shareable artifact (§5 step 6).
  // ?download=1 serves the same self-contained HTML as a file download.
  app.get<{ Params: { scanId: string }; Querystring: { download?: string } }>(
    '/r/:scanId',
    async (request, reply) => {
      const job = jobs.get(request.params.scanId);
      if (!job) return reply.code(404).type('text/html').send('<h1>Report not found</h1>');
      if (request.query.download !== undefined) {
        reply.header(
          'Content-Disposition',
          `attachment; filename="owed-audit-${downloadSlug(job)}.html"`,
        );
      }
      return reply.type('text/html').send(renderReportHtml(job, BASE_URL));
    },
  );

  // Hosted claim-kit page (paid tool returns this URL; the page itself is
  // unguessable — scanIds are UUIDs — matching the report-page model).
  app.get<{ Params: { scanId: string }; Querystring: { download?: string } }>(
    '/k/:scanId',
    async (request, reply) => {
      const job = jobs.get(request.params.scanId);
      if (!job || job.status !== 'complete' || job.result?.status !== 'complete') {
        return reply.code(404).type('text/html').send('<h1>Claim kit not found</h1>');
      }
      if (request.query.download !== undefined) {
        reply.header(
          'Content-Disposition',
          `attachment; filename="owed-claim-kit-${downloadSlug(job)}.html"`,
        );
      }
      return reply
        .type('text/html')
        .send(renderKitHtml(generateClaimKit(job.result), job.scanId, BASE_URL));
    },
  );

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
    const paymentHeader =
      (request.headers['x-payment'] as string | undefined) ??
      (request.headers['payment-signature'] as string | undefined);

    // x402 gate at the HTTP layer (A2MCP compliance): paid tools/call without
    // payment → 402 with the PAYMENT-REQUIRED header the marketplace
    // validates. With Dev Portal keys the OKX Payment SDK also verifies and
    // settles on-chain before any work runs; without them the hand-rolled
    // challenge keeps the endpoint compliant but refuses paid headers.
    // Demo bypass: a secret header lets the owner's own agent test free while
    // the endpoint stays 402-compliant for everyone else. Enabled only when
    // PAYMENT_DEMO_KEY is set.
    const demoKey = process.env.PAYMENT_DEMO_KEY;
    const isDemoCall = Boolean(demoKey) && request.headers['x-owed-demo'] === demoKey;

    if (!isDemoCall && paymentCfg.mode === 'x402' && paidToolForBody(request.body)) {
      if (sdkGate) {
        const result = await sdkGate.handle(request, paymentHeader);
        if (result.kind === 'respond') {
          return reply
            .code(result.response.status)
            .headers(result.response.headers)
            .send(result.response.body ?? '');
        }
        for (const [k, v] of Object.entries(result.settlementHeaders)) {
          reply.raw.setHeader(k, v);
        }
      } else {
        const gate = gateMcpHttp(request.body, paymentHeader, paymentCfg, `${BASE_URL}/mcp`);
        if (gate) return reply.code(gate.status).headers(gate.headers).send(gate.body);
      }
    }

    // Stateless mode: fresh server + transport per request, no session ids.
    const server = buildMcpServer(paymentHeader, isDemoCall);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    request.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  // Stateless server: sessions/SSE-resume are not offered. A browser GET gets
  // a self-description instead of a bare error — listing reviewers click URLs.
  app.get('/mcp', async (_req, reply) =>
    reply.code(200).send({
      service: 'Owed — royalty leak scanner',
      protocol: 'MCP (streamable HTTP, stateless). Connect with an MCP client and POST JSON-RPC here.',
      tools: {
        royalty_quick_check: '$0.05 — sampled leak preview for an artist',
        royalty_leak_scan: '$0.50 — full-catalog audit; returns scanId, poll scan_status',
        claim_kit_generate: '$5 — personalized fix plan from a completed scan',
        scan_status: 'free — poll a scan; returns the report + hosted reportUrl when done',
      },
      website: 'https://useowed.xyz',
      note: 'Owed is not affiliated with The MLC. Findings link to public registry records.',
    }),
  );

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Blackbox MCP server on :${PORT} (payment mode: ${paymentCfg.mode})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
