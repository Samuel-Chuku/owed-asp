// Scan orchestration — the full §5 pipeline as a reusable function shared by
// the CLI script and the MCP server. Pure orchestration: all verdicts come
// from the gap engine, all money from the estimator.

import { join } from 'node:path';
import { MlcClient, toMlcWork, type RawWork } from '../crawlers/mlc.js';
import { resolveArtist, type ArtistCandidate } from '../identity/index.js';
import {
  detectUnregisteredTracks,
  detectWorkGaps,
  leakScore,
  verifyWorksByIsrc,
} from '../gap-engine/index.js';
import { estimateWork } from '../estimator/index.js';
import { YoutubeClient } from '../streams/youtube.js';
import type { CanonicalArtist, Estimate, Gap, MlcWork } from '../types.js';

export type ScanProgress = (message: string) => void;

export type ScanResult =
  | { status: 'not_found'; query: string }
  | { status: 'ambiguous'; query: string; candidates: ArtistCandidate[] }
  | {
      status: 'complete';
      artist: CanonicalArtist;
      works: MlcWork[];
      unverifiedCount: number;
      gaps: Gap[];
      estimates: Estimate[];
      leakScore: number;
      generatedAt: string;
    };

export function defaultMlcClient(rootDir: string): MlcClient {
  return new MlcClient({
    snapshotDir: join(rootDir, 'data', 'snapshots'),
    cacheDir: join(rootDir, 'data', 'cache'),
  });
}

export async function runScan(
  artistName: string,
  opts: {
    client: MlcClient;
    maxTracks?: number;
    onProgress?: ScanProgress;
    /** Enables stream counts + dollar-range estimates when set. */
    youtubeApiKey?: string;
    youtubeCacheDir?: string;
  },
): Promise<ScanResult> {
  const progress = opts.onProgress ?? (() => {});
  const maxTracks = opts.maxTracks ?? 25;

  progress('resolving identity (MusicBrainz + Deezer)');
  const resolved = await resolveArtist(artistName);
  if (resolved.status === 'not_found') return { status: 'not_found', query: artistName };
  if (resolved.status === 'ambiguous') {
    return { status: 'ambiguous', query: artistName, candidates: resolved.candidates };
  }
  const artist = resolved.artist;

  const withIsrcs = artist.tracks.filter((t) => t.isrcs.length > 0);
  const titles = [...new Set(withIsrcs.map((t) => t.title))].slice(0, maxTracks);
  const artistIsrcs = new Set(withIsrcs.flatMap((t) => t.isrcs.map((i) => i.toUpperCase())));

  const candidates = new Map<string, { raw: RawWork; snapshotPath: string }>();
  const titleSnapshots = new Map<string, string>();
  let searchSnapshot = '';
  for (const [i, title] of titles.entries()) {
    progress(`searching MLC ${i + 1}/${titles.length}: "${title}"`);
    const res = await opts.client.searchWorksByTitle(title, 0, 25);
    searchSnapshot ||= res.snapshotPath;
    titleSnapshots.set(title, res.snapshotPath);
    for (const raw of res.works) {
      const hit = (raw.matchedRecordings?.recordings ?? []).some(
        (r) => r.isrc && artistIsrcs.has(r.isrc.toUpperCase()),
      );
      if (hit && !candidates.has(raw.songCode)) {
        candidates.set(raw.songCode, { raw, snapshotPath: res.snapshotPath });
      }
    }
  }

  progress(`fetching matched recordings for ${candidates.size} candidate works`);
  const works: MlcWork[] = [];
  for (const { raw, snapshotPath } of candidates.values()) {
    const { recordings } = await opts.client.fetchMatchedRecordings(raw.songCode);
    works.push(toMlcWork(raw, recordings, snapshotPath));
  }
  const { verified, unverified } = verifyWorksByIsrc(works, artist);

  const gaps: Gap[] = verified.flatMap((w) => detectWorkGaps(w));
  const scannedTitles = new Set(titles);
  const scannedArtist = { ...artist, tracks: withIsrcs.filter((t) => scannedTitles.has(t.title)) };
  const unregGaps = detectUnregisteredTracks(scannedArtist, verified, (title) => ({
    url: 'https://portal.themlc.com/search#work',
    snapshotPath: titleSnapshots.get(title) ?? searchSnapshot,
  }));
  const allGaps = [...gaps, ...unregGaps];

  // Step 5 — stream counts + estimates (only when a YouTube key is set).
  // A verified work's canonical track is the one whose ISRCs intersect its
  // matched recordings; without stream data a work simply gets no estimate.
  const estimates: Estimate[] = [];
  if (opts.youtubeApiKey) {
    const yt = new YoutubeClient(
      opts.youtubeApiKey,
      opts.youtubeCacheDir ?? join(process.cwd(), 'data', 'cache'),
    );
    const trackForWork = (w: MlcWork) => {
      const workIsrcs = new Set(
        w.matchedRecordings.map((r) => r.isrc?.toUpperCase()).filter(Boolean),
      );
      return scannedArtist.tracks.find((t) => t.isrcs.some((i) => workIsrcs.has(i.toUpperCase())));
    };
    const fetchStreams = async (track: (typeof scannedArtist.tracks)[number], label: string) => {
      try {
        const count = await yt.viewCount(scannedArtist.resolvedName, track.title);
        if (count !== null && count > 0) {
          track.streams = [{ source: 'youtube', count, asOf: new Date().toISOString().slice(0, 10) }];
        }
      } catch {
        progress(`stream lookup failed for "${label}" — continuing without estimate`);
      }
    };
    for (const [i, work] of verified.entries()) {
      const track = trackForWork(work);
      if (!track) continue;
      progress(`fetching stream counts ${i + 1}/${verified.length}: "${track.title}"`);
      await fetchStreams(track, track.title);
      if (track.streams.length) {
        const est = estimateWork(work, track);
        if (est) estimates.push(est);
      }
    }
    // Unregistered tracks are the largest leaks — they need stream weights
    // too, or the split bar and leak score undercount them.
    const unregTitles = new Set(
      unregGaps.map((g) => /^"(.+?)"/.exec(g.detail)?.[1]).filter(Boolean),
    );
    const unregTracks = scannedArtist.tracks.filter((t) => unregTitles.has(t.title));
    for (const [i, track] of unregTracks.entries()) {
      progress(`fetching stream counts for unregistered ${i + 1}/${unregTracks.length}: "${track.title}"`);
      await fetchStreams(track, track.title);
    }
  }

  return {
    status: 'complete',
    artist: scannedArtist,
    works: verified,
    unverifiedCount: unverified.length,
    gaps: allGaps,
    estimates,
    leakScore: leakScore(allGaps, verified, scannedArtist),
    generatedAt: new Date().toISOString(),
  };
}
