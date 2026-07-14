// YouTube Data API v3 stream counts — the official, free public play metric
// (spec §5 step 5). One search.list (100 quota units) + one videos.list
// (1 unit) per track, disk-cached 7 days so repeat scans cost zero quota.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://www.googleapis.com/youtube/v3';

export class YoutubeClient {
  constructor(
    private readonly apiKey: string,
    private readonly cacheDir: string,
    private readonly cacheTtlMs = 7 * 24 * 3600 * 1000,
  ) {
    mkdirSync(cacheDir, { recursive: true });
  }

  /**
   * Best-effort view count for a track: top search result for
   * "<artist> <title>", then its statistics.viewCount. Returns null when
   * nothing sensible is found — callers must treat null as "no estimate",
   * never as zero.
   */
  async viewCount(artist: string, title: string): Promise<number | null> {
    const key = createHash('sha256').update(`yt ${artist} ${title}`.toLowerCase()).digest('hex').slice(0, 24);
    const cachePath = join(this.cacheDir, `yt_${key}.json`);
    if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < this.cacheTtlMs) {
      return JSON.parse(readFileSync(cachePath, 'utf8')).count;
    }

    const q = `${artist} ${title}`;
    const searchUrl = `${API}/search?part=snippet&type=video&maxResults=3&q=${encodeURIComponent(q)}&key=${this.apiKey}`;
    const search = await this.get(searchUrl);
    const ids = ((search.items ?? []) as any[])
      .map((i) => i.id?.videoId)
      .filter((v): v is string => !!v);
    if (ids.length === 0) {
      writeFileSync(cachePath, JSON.stringify({ count: null }));
      return null;
    }

    const statsUrl = `${API}/videos?part=statistics&id=${ids.join(',')}&key=${this.apiKey}`;
    const stats = await this.get(statsUrl);
    const counts = ((stats.items ?? []) as any[])
      .map((i) => Number(i.statistics?.viewCount))
      .filter((n) => Number.isFinite(n));
    // The artist's own upload is usually the top-viewed of the top matches.
    const count = counts.length ? Math.max(...counts) : null;
    writeFileSync(cachePath, JSON.stringify({ count }));
    return count;
  }

  private async get(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return res.json();
  }
}
