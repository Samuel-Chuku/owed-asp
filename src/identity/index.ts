// Identity resolver — §5 step 1. MusicBrainz is the keyless backbone (artist
// search with aliases + recordings with ISRCs). Spotify enrichment is added
// when SPOTIFY_CLIENT_ID/SECRET are configured. If multiple plausible artist
// candidates exist, we surface them and require the caller to pick — never
// guess on a paid scan (the two-Remas rule).

import { setDefaultResultOrder } from 'node:dns';
import type { CanonicalArtist, CanonicalTrack } from '../types.js';

// musicbrainz.org publishes AAAA records; on hosts without working IPv6 the
// default happy-eyeballs order makes undici time out. Prefer IPv4.
setDefaultResultOrder('ipv4first');

const MB = 'https://musicbrainz.org/ws/2';
const MB_UA = 'BlackboxRoyaltyScanner/0.1 (samuelchuku01@gmail.com)';

let lastMbCall = 0;
async function mbFetch(path: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 1500));
    // MusicBrainz allows 1 request/second per client — respect it strictly.
    const wait = lastMbCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastMbCall = Date.now();
    try {
      const res = await fetch(`${MB}${path}`, {
        headers: { 'User-Agent': MB_UA, Accept: 'application/json' },
      });
      if (res.status === 429 || res.status === 503 || res.status >= 500) {
        lastErr = new Error(`MusicBrainz ${res.status} on ${path}`);
        continue;
      }
      if (!res.ok) throw new Error(`MusicBrainz ${res.status} on ${path}`);
      return await res.json();
    } catch (err) {
      lastErr = err; // TLS resets from MB are common; retry
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export type ArtistCandidate = {
  mbid: string;
  name: string;
  score: number;
  disambiguation?: string;
  country?: string;
  aliases: string[];
};

export async function searchArtistCandidates(name: string): Promise<ArtistCandidate[]> {
  const json = await mbFetch(`/artist?query=${encodeURIComponent(name)}&fmt=json&limit=8`);
  return ((json.artists ?? []) as any[]).map((a) => ({
    mbid: a.id,
    name: a.name,
    score: a.score ?? 0,
    disambiguation: a.disambiguation,
    country: a.country,
    aliases: (a.aliases ?? []).map((al: any) => al.name),
  }));
}

/** Browse all recordings for an artist, collecting ISRCs. */
export async function fetchArtistRecordings(mbid: string, maxPages = 10): Promise<CanonicalTrack[]> {
  const byTitle = new Map<string, Set<string>>();
  for (let page = 0; page < maxPages; page++) {
    const json = await mbFetch(
      `/recording?artist=${mbid}&inc=isrcs&fmt=json&limit=100&offset=${page * 100}`,
    );
    const recs = (json.recordings ?? []) as any[];
    for (const r of recs) {
      const title = (r.title as string).trim();
      if (!byTitle.has(title.toUpperCase())) byTitle.set(title.toUpperCase(), new Set());
      for (const isrc of r.isrcs ?? []) byTitle.get(title.toUpperCase())!.add(isrc);
    }
    if ((page + 1) * 100 >= (json['recording-count'] ?? 0)) break;
  }
  // Keep original-cased title from the first occurrence; ISRC-less recordings
  // still appear (title-only) so the caller sees the full catalog.
  const tracks: CanonicalTrack[] = [];
  for (const [upper, isrcs] of byTitle) {
    tracks.push({ title: upper, isrcs: [...isrcs], streams: [] });
  }
  return tracks;
}

// ---- Deezer catalog source ----
// MusicBrainz coverage of Afrobeats catalogs is thin (Shallipopi: 29 ISRCs,
// no Speedometer). Deezer's API is keyless and album tracklists carry ISRCs,
// so it is the primary catalog source; MusicBrainz remains the identity/alias
// authority. Spotify enrichment can be added later behind env keys.

const DEEZER = 'https://api.deezer.com';

let lastDzCall = 0;
async function dzFetch(path: string): Promise<any> {
  // Deezer quota is 50 requests per 5 s; stay well under it.
  const wait = lastDzCall + 250 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastDzCall = Date.now();
  const res = await fetch(`${DEEZER}${path}`);
  if (!res.ok) throw new Error(`Deezer ${res.status} on ${path}`);
  const json: any = await res.json();
  if (json.error) throw new Error(`Deezer error on ${path}: ${JSON.stringify(json.error)}`);
  return json;
}

export async function fetchDeezerCatalog(
  artistName: string,
  maxAlbums = Infinity,
): Promise<CanonicalTrack[]> {
  const search = await dzFetch(`/search/artist?q=${encodeURIComponent(artistName)}&limit=5`);
  const candidates = (search.data ?? []) as { id: number; name: string }[];
  const artist =
    candidates.find((a) => a.name.toUpperCase() === artistName.toUpperCase()) ?? candidates[0];
  if (!artist) return [];

  let albums: { id: number; releaseDate?: string }[] = [];
  let next = `/artist/${artist.id}/albums?limit=100`;
  while (next && albums.length < maxAlbums) {
    const page = await dzFetch(next);
    for (const a of page.data ?? []) albums.push({ id: a.id, releaseDate: a.release_date });
    next = page.next ? page.next.replace(DEEZER, '') : '';
  }
  albums = albums.slice(0, maxAlbums);

  const byTitle = new Map<
    string,
    { title: string; isrcs: Set<string>; releaseDate?: string; rank?: number }
  >();
  for (const album of albums) {
    const tracks = await dzFetch(`/album/${album.id}/tracks?limit=100`);
    for (const t of tracks.data ?? []) {
      const key = (t.title_short ?? t.title).trim().toUpperCase();
      if (!byTitle.has(key)) byTitle.set(key, { title: key, isrcs: new Set() });
      const entry = byTitle.get(key)!;
      if (t.isrc) entry.isrcs.add(t.isrc.toUpperCase());
      // keep the earliest release date seen for the title
      if (album.releaseDate && (!entry.releaseDate || album.releaseDate < entry.releaseDate)) {
        entry.releaseDate = album.releaseDate;
      }
      // keep the highest popularity rank seen for the title
      if (typeof t.rank === 'number' && (entry.rank === undefined || t.rank > entry.rank)) {
        entry.rank = t.rank;
      }
    }
  }
  return [...byTitle.values()].map((t) => ({
    title: t.title,
    isrcs: [...t.isrcs],
    releaseDate: t.releaseDate,
    rank: t.rank,
    streams: [],
  }));
}

/** Merge track lists by uppercase title, unioning ISRCs. */
export function mergeCatalogs(...lists: CanonicalTrack[][]): CanonicalTrack[] {
  const byTitle = new Map<string, CanonicalTrack>();
  for (const list of lists) {
    for (const t of list) {
      const key = t.title.toUpperCase();
      const existing = byTitle.get(key);
      if (!existing) {
        byTitle.set(key, { ...t, title: key, isrcs: [...new Set(t.isrcs.map((i) => i.toUpperCase()))] });
      } else {
        existing.isrcs = [...new Set([...existing.isrcs, ...t.isrcs.map((i) => i.toUpperCase())])];
        if (t.releaseDate && (!existing.releaseDate || t.releaseDate < existing.releaseDate)) {
          existing.releaseDate = t.releaseDate;
        }
        if (t.rank !== undefined && (existing.rank === undefined || t.rank > existing.rank)) {
          existing.rank = t.rank;
        }
      }
    }
  }
  return [...byTitle.values()];
}

export async function resolveArtist(
  queryName: string,
  opts: {
    /**
     * Sampled-preview mode (quick check): Deezer-only catalog capped at the
     * 25 newest albums, MusicBrainz used for identity only. Mega-artist
     * catalogs (100s of albums) otherwise take minutes to enumerate.
     */
    quickCatalog?: boolean;
  } = {},
): Promise<
  | { status: 'resolved'; artist: CanonicalArtist }
  | { status: 'ambiguous'; candidates: ArtistCandidate[] }
  | { status: 'not_found' }
> {
  const candidates = await searchArtistCandidates(queryName);
  if (candidates.length === 0) return { status: 'not_found' };

  const [top, second] = candidates;
  // Ambiguity rule: a near-tie at the top means the caller must choose.
  if (second && top.score - second.score < 10 && second.score >= 85) {
    return { status: 'ambiguous', candidates: candidates.filter((c) => c.score >= 85) };
  }

  const [mbTracks, dzTracks] = await Promise.all([
    opts.quickCatalog ? Promise.resolve([]) : fetchArtistRecordings(top.mbid),
    fetchDeezerCatalog(top.name, opts.quickCatalog ? 25 : Infinity),
  ]);
  const tracks = mergeCatalogs(mbTracks, dzTracks);
  return {
    status: 'resolved',
    artist: {
      queryName,
      resolvedName: top.name,
      aliases: top.aliases,
      mbid: top.mbid,
      tracks,
      disambiguation: {
        candidates: candidates.slice(0, 5).map((c) => `${c.name}${c.disambiguation ? ` (${c.disambiguation})` : ''}`),
        confidence: top.score >= 95 ? 'high' : top.score >= 85 ? 'medium' : 'low',
        notes: top.disambiguation ?? '',
      },
    },
  };
}
