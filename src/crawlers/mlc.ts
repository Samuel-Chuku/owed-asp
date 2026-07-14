// MLC public work search client.
// Discovered in the Day-1 spike: portal.themlc.com is an SPA over a public
// JSON API at api.ptl.themlc.com that is reachable with plain HTTP. We use it
// directly — no browser — with polite rate limiting and on-disk caching per
// the non-negotiables (§3.6). Every raw response is snapshotted to disk for
// report provenance.
//
// Endpoints (captured from real portal traffic, fixtures/recon*/network-log.json):
//   POST /api2v/public/search/works?page={n}&size={n}   body {"combinedTitles": "..."}
//   GET  /api/dsp-recording/matched/{songCode}?page={n}&limit={n}&order=matchedAmount&direction=desc
//   GET  /api2v/public/search/works/suggestions?property=combinedTitles&searchTerm=...

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MlcWork } from '../types.js';

const API = 'https://api.ptl.themlc.com';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const WRITER_ROLES: Record<number, string> = {
  7: 'Adaptor',
  8: 'Arranger',
  9: 'Author',
  10: 'Composer',
  11: 'Composer/Author',
  12: 'Sub Arranger',
  13: 'Sub Author',
  14: 'Translator',
};

// ---- raw API shapes (only the fields we consume) ----

export type RawWriter = {
  ipId: number;
  fullName: string;
  ipiNumber: string | null;
  roleCode: number;
};

export type RawPublisher = {
  ipId: number;
  publisherName: string;
  ipiNumber: string | null;
  publisherShare: number;
  administratorPublishers: {
    publisherName: string;
    ipiNumber: string | null;
    publisherShare: number;
  }[];
  writers: RawWriter[];
};

export type RawWork = {
  id: number;
  title: string;
  songCode: string;
  iswc: string | null;
  writers: RawWriter[];
  originalPublishers: RawPublisher[];
  totalKnownShares: number;
  matchedRecordings: {
    count: number;
    recordings: RawRecording[];
  };
};

export type RawRecording = {
  isrc: string | null;
  dsp: string;
  recordingTitle: string | null;
  recordingDisplayArtistName: string | null;
  label: string | null;
  releaseDate?: string | null;
};

export type WorkSearchResult = {
  totalElements: number;
  works: RawWork[];
  snapshotPath: string;
  sourceUrl: string;
};

export class MlcClient {
  private lastRequestAt = 0;

  constructor(
    private readonly opts: {
      snapshotDir: string;
      cacheDir: string;
      minDelayMs?: number; // between live requests; default 3000 (§3.6)
      cacheTtlMs?: number; // default 7 days for work data
    },
  ) {
    mkdirSync(opts.snapshotDir, { recursive: true });
    mkdirSync(opts.cacheDir, { recursive: true });
  }

  async searchWorksByTitle(title: string, page = 0, size = 25): Promise<WorkSearchResult> {
    const url = `${API}/api2v/public/search/works?page=${page}&size=${size}`;
    const body = JSON.stringify({ combinedTitles: title });
    const { json, snapshotPath } = await this.request('POST', url, body, `search_${slug(title)}_p${page}`);
    return {
      totalElements: json.totalElements ?? 0,
      works: (json.content ?? []) as RawWork[],
      snapshotPath,
      sourceUrl: `https://portal.themlc.com/search#work`,
    };
  }

  /** All matched recordings for a work, ordered by matched royalty amount. */
  async fetchMatchedRecordings(songCode: string, maxPages = 20): Promise<{ recordings: RawRecording[]; snapshotPaths: string[] }> {
    const recordings: RawRecording[] = [];
    const snapshotPaths: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = `${API}/api/dsp-recording/matched/${encodeURIComponent(songCode)}?page=${page}&limit=50&order=matchedAmount&direction=desc`;
      const { json, snapshotPath } = await this.request('GET', url, undefined, `recordings_${songCode}_p${page}`);
      const batch = (json.recordings ?? []) as RawRecording[];
      snapshotPaths.push(snapshotPath);
      recordings.push(...batch);
      if (batch.length < 50) break;
    }
    return { recordings, snapshotPaths };
  }

  // ---- transport with cache, rate limit, backoff, snapshots ----

  private async request(
    method: 'GET' | 'POST',
    url: string,
    body: string | undefined,
    label: string,
  ): Promise<{ json: any; snapshotPath: string }> {
    const ttl = this.opts.cacheTtlMs ?? 7 * 24 * 3600 * 1000;
    const key = createHash('sha256').update(`${method} ${url} ${body ?? ''}`).digest('hex').slice(0, 24);
    const cachePath = join(this.opts.cacheDir, `${key}.json`);

    if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < ttl) {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      return { json: cached.json, snapshotPath: cached.snapshotPath };
    }

    const minDelay = this.opts.minDelayMs ?? 3000;
    const wait = this.lastRequestAt + minDelay - Date.now();
    if (wait > 0) await sleep(wait);

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(2 ** attempt * 5000); // 10s, 20s, 40s backoff
      this.lastRequestAt = Date.now();
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            Origin: 'https://portal.themlc.com',
            Referer: 'https://portal.themlc.com/',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body,
        });
        if (res.status === 429 || res.status === 403 || res.status >= 500) {
          lastErr = new Error(`MLC API ${res.status} on ${url}`);
          continue;
        }
        if (!res.ok) throw new Error(`MLC API ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
        const json = await res.json();
        const snapshotPath = join(this.opts.snapshotDir, `${Date.now()}_${label}.json`);
        writeFileSync(snapshotPath, JSON.stringify({ url, method, body, fetchedAt: new Date().toISOString(), json }, null, 1));
        writeFileSync(cachePath, JSON.stringify({ json, snapshotPath }));
        return { json, snapshotPath };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

/** Map a raw API work (+ full recordings list) into the shared MlcWork schema. */
export function toMlcWork(raw: RawWork, recordings: RawRecording[], snapshotPath: string): MlcWork {
  return {
    title: raw.title,
    mlcSongCode: raw.songCode,
    iswc: raw.iswc ?? undefined,
    writers: raw.writers.map((w) => ({
      name: w.fullName,
      ipi: w.ipiNumber ?? undefined,
      role: WRITER_ROLES[w.roleCode] ?? String(w.roleCode),
    })),
    publishers: raw.originalPublishers.map((p) => ({
      name: p.publisherName,
      ipi: p.ipiNumber ?? undefined,
      // An original publisher's collectable share is administered by its admin
      // chain when present; otherwise its own share.
      collectionShare: p.administratorPublishers.length
        ? p.administratorPublishers.reduce((s, a) => s + a.publisherShare, 0)
        : p.publisherShare,
      representedWriters: p.writers.map((w) => w.fullName),
    })),
    totalShares: raw.totalKnownShares,
    matchedRecordings: recordings.map((r) => ({
      artist: r.recordingDisplayArtistName ?? '',
      title: r.recordingTitle ?? '',
      isrc: r.isrc ?? undefined,
      dsp: r.dsp,
      label: r.label ?? undefined,
    })),
    sourceUrl: `https://portal.themlc.com/catalog/work/${raw.id}`,
    snapshotPath,
    fetchedAt: new Date().toISOString(),
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
