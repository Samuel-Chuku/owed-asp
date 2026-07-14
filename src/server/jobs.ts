// File-backed scan job store. Postgres comes with the VPS deploy; for now a
// JSON file per job keeps the MCP server stateless and restart-safe (§8: the
// queue outlives the process, no Redis at this scale).

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanResult } from '../pipeline/scan.js';

export type ScanJob = {
  scanId: string;
  artistQuery: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  progress: string[];
  result?: ScanResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export class JobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  create(artistQuery: string): ScanJob {
    const now = new Date().toISOString();
    const job: ScanJob = {
      scanId: randomUUID(),
      artistQuery,
      status: 'queued',
      progress: [],
      createdAt: now,
      updatedAt: now,
    };
    this.save(job);
    return job;
  }

  get(scanId: string): ScanJob | null {
    const path = this.path(scanId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as ScanJob;
  }

  /** Most recent completed scan for an artist within maxAgeMs (24h scan cache, §3.6). */
  findRecentComplete(artistQuery: string, maxAgeMs = 24 * 3600 * 1000): ScanJob | null {
    const cutoff = Date.now() - maxAgeMs;
    let best: ScanJob | null = null;
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const job = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as ScanJob;
        if (
          job.status === 'complete' &&
          job.artistQuery.toLowerCase() === artistQuery.toLowerCase() &&
          Date.parse(job.updatedAt) >= cutoff &&
          (!best || job.updatedAt > best.updatedAt)
        ) {
          best = job;
        }
      } catch {
        // unreadable job file — skip it
      }
    }
    return best;
  }

  update(job: ScanJob): void {
    job.updatedAt = new Date().toISOString();
    this.save(job);
  }

  private save(job: ScanJob): void {
    writeFileSync(this.path(job.scanId), JSON.stringify(job, null, 1));
  }

  private path(scanId: string): string {
    // scanIds are always server-generated UUIDs; still, never trust a path segment
    return join(this.dir, `${scanId.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
  }
}
