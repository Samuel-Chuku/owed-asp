// Scan orchestration — the full §5 pipeline as a reusable function shared by
// the CLI script and the MCP server. Pure orchestration: all verdicts come
// from the gap engine, all money from the estimator.

import { join } from 'node:path';
import { MlcClient, toMlcWork, type RawRecording, type RawWork } from '../crawlers/mlc.js';
import { resolveArtist, type ArtistCandidate } from '../identity/index.js';
import {
  detectUnregisteredTracks,
  detectWorkGaps,
  leakScore,
  REGISTRATION_LAG_MS,
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
    /**
     * 'quick' = sampled preview (quick check): capped catalog fetch, one page
     * of matched recordings per work. 'full' (default) crawls everything.
     */
    depth?: 'quick' | 'full';
  },
): Promise<ScanResult> {
  const progress = opts.onProgress ?? (() => {});
  const maxTracks = opts.maxTracks ?? 25;
  const quick = opts.depth === 'quick';

  progress('resolving identity (MusicBrainz + Deezer)');
  const resolved = await resolveArtist(artistName, { quickCatalog: quick });
  if (resolved.status === 'not_found') return { status: 'not_found', query: artistName };
  if (resolved.status === 'ambiguous') {
    return { status: 'ambiguous', query: artistName, candidates: resolved.candidates };
  }
  const artist = resolved.artist;

  const withIsrcs = artist.tracks.filter((t) => t.isrcs.length > 0);
  // Spend the title budget on tracks old enough to give a determinate
  // registered/unregistered answer first; releases still inside the
  // registration-lag window can only ever come back as "monitor" warnings.
  // Within each group, most-popular first (Deezer rank) — a sampled check
  // should assess the songs people actually know, not obscure album cuts.
  const lagCutoff = Date.now() - REGISTRATION_LAG_MS;
  const determinate = (t: { releaseDate?: string }) =>
    !t.releaseDate || Date.parse(t.releaseDate) < lagCutoff;
  const byRank = (a: { rank?: number }, b: { rank?: number }) => (b.rank ?? 0) - (a.rank ?? 0);
  const ordered = [
    ...withIsrcs.filter(determinate).sort(byRank),
    ...withIsrcs.filter((t) => !determinate(t)).sort(byRank),
  ];
  const titles = [...new Set(ordered.map((t) => t.title))].slice(0, maxTracks);
  const artistIsrcs = new Set(withIsrcs.flatMap((t) => t.isrcs.map((i) => i.toUpperCase())));

  const candidates = new Map<
    string,
    { raw: RawWork; snapshotPath: string; recordings?: RawRecording[] }
  >();
  const titleSnapshots = new Map<string, string>();
  // ISRCs of the artist's already covered by some candidate work — used to
  // decide whether a title still needs the deep check below.
  const coveredIsrcs = new Set<string>();
  // Name tokens (artist + aliases, e.g. legal names) for ranking which
  // exact-title works to deep-check first. Selection heuristic only — the
  // actual verification below stays ISRC-based (non-negotiable 2).
  const nameTokens = new Set(
    [artist.resolvedName, ...artist.aliases]
      .flatMap((n) => n.toUpperCase().split(/[^A-Z0-9]+/))
      .filter((t) => t.length >= 3),
  );
  const nameSignal = (w: RawWork): number => {
    const inTokens = (s: string | null | undefined) =>
      (s ?? '').toUpperCase().split(/[^A-Z0-9]+/).some((t) => t.length >= 3 && nameTokens.has(t));
    let score = 0;
    if ((w.matchedRecordings?.recordings ?? []).some((r) => inTokens(r.recordingDisplayArtistName)))
      score += 2;
    if ((w.writers ?? []).some((wr) => inTokens(wr.fullName))) score += 1;
    return score;
  };
  let searchSnapshot = '';
  for (const [i, title] of titles.entries()) {
    progress(`searching MLC ${i + 1}/${titles.length}: "${title}"`);
    const res = await opts.client.searchWorksByTitle(title, 0, 25);
    searchSnapshot ||= res.snapshotPath;
    titleSnapshots.set(title, res.snapshotPath);
    for (const raw of res.works) {
      const hits = (raw.matchedRecordings?.recordings ?? [])
        .map((r) => r.isrc?.toUpperCase())
        .filter((x): x is string => Boolean(x) && artistIsrcs.has(x!));
      if (hits.length && !candidates.has(raw.songCode)) {
        candidates.set(raw.songCode, { raw, snapshotPath: res.snapshotPath });
      }
      for (const x of hits) coveredIsrcs.add(x);
    }

    // Deep check: the search result embeds only a work's first 10 matched
    // recordings, so big works (mega-artist catalogs, heavily covered songs)
    // fail the cheap ISRC test above and would be falsely flagged as
    // unregistered. For exact-title works, look at the top page of the full
    // matched-recordings list (ordered by matched royalty amount) before
    // giving up. Verification stays ISRC-only (non-negotiable 2).
    const titleIsrcs = withIsrcs
      .filter((t) => t.title.toUpperCase() === title.toUpperCase())
      .flatMap((t) => t.isrcs.map((x) => x.toUpperCase()));
    if (!titleIsrcs.some((x) => coveredIsrcs.has(x))) {
      // Shared budget of 3 recordings fetches per title, spent on the works
      // with the highest artist-name signal first (display artist on embedded
      // recordings, then writer names).
      let deepBudget = 3;
      const deepCheck = async (works: RawWork[], snapshotPath: string): Promise<boolean> => {
        const exactMatches = works
          .filter(
            (w) =>
              w.title?.trim().toUpperCase() === title.toUpperCase() && !candidates.has(w.songCode),
          )
          .sort((a, b) => nameSignal(b) - nameSignal(a));
        for (const raw of exactMatches) {
          if (deepBudget <= 0) return false;
          deepBudget--;
          const { recordings } = await opts.client.fetchMatchedRecordings(raw.songCode, 1);
          const hits = recordings
            .map((r) => r.isrc?.toUpperCase())
            .filter((x): x is string => Boolean(x) && artistIsrcs.has(x!));
          if (hits.length) {
            candidates.set(raw.songCode, { raw, snapshotPath, recordings });
            for (const x of hits) coveredIsrcs.add(x);
            return true;
          }
        }
        return false;
      };
      let found = await deepCheck(res.works, res.snapshotPath);
      // Full scans dig deeper: the artist's work may rank past the first 25
      // title-search results (generic titles, mega catalogs). Quick checks
      // skip this — latency budget.
      const extraPages = quick ? 0 : 2;
      for (let p = 1; !found && p <= extraPages && deepBudget > 0 && res.totalElements > p * 25; p++) {
        const more = await opts.client.searchWorksByTitle(title, p, 25);
        found = await deepCheck(more.works, more.snapshotPath);
      }
    }
  }

  progress(`fetching matched recordings for ${candidates.size} candidate works`);
  const works: MlcWork[] = [];
  for (const { raw, snapshotPath, recordings: prefetched } of candidates.values()) {
    const recordings =
      quick && prefetched
        ? prefetched
        : (await opts.client.fetchMatchedRecordings(raw.songCode, quick ? 1 : 20)).recordings;
    works.push(toMlcWork(raw, recordings, snapshotPath));
  }
  const { verified, unverified } = verifyWorksByIsrc(works, artist);

  const gaps: Gap[] = verified.flatMap((w) => detectWorkGaps(w));
  const scannedTitles = new Set(titles);
  const scannedArtist = { ...artist, tracks: withIsrcs.filter((t) => scannedTitles.has(t.title)) };
  const unregGaps = detectUnregisteredTracks(
    scannedArtist,
    verified,
    (title) => ({
      url: 'https://portal.themlc.com/search#work',
      snapshotPath: titleSnapshots.get(title) ?? searchSnapshot,
    }),
    { sampled: quick },
  );
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
