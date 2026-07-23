// Shared data schema — §4 of the build spec. Zod schemas are the source of
// truth; the exported types are inferred from them so MCP tool schemas and
// internal code can never drift apart.

import { z } from 'zod';

export const StreamCountSchema = z.object({
  source: z.enum(['youtube', 'spotify_scrape']),
  count: z.number().int().nonnegative(),
  asOf: z.string(), // ISO date
});

export const CanonicalTrackSchema = z.object({
  title: z.string(),
  isrcs: z.array(z.string()), // from MusicBrainz + Spotify
  spotifyId: z.string().optional(),
  releaseDate: z.string().optional(),
  rank: z.number().optional(), // Deezer popularity — drives sampling order
  streams: z.array(StreamCountSchema),
});
export type CanonicalTrack = z.infer<typeof CanonicalTrackSchema>;

export const CanonicalArtistSchema = z.object({
  queryName: z.string(),
  resolvedName: z.string(),
  aliases: z.array(z.string()), // stage name, legal name (Crown Uzamah lesson)
  mbid: z.string().optional(), // MusicBrainz ID
  spotifyId: z.string().optional(),
  tracks: z.array(CanonicalTrackSchema),
  disambiguation: z.object({
    candidates: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']),
    notes: z.string(),
  }),
});
export type CanonicalArtist = z.infer<typeof CanonicalArtistSchema>;

export const MlcWorkSchema = z.object({
  title: z.string(),
  mlcSongCode: z.string(),
  iswc: z.string().optional(),
  writers: z.array(
    z.object({
      name: z.string(),
      ipi: z.string().optional(),
      role: z.string(),
    }),
  ),
  publishers: z.array(
    z.object({
      name: z.string(),
      ipi: z.string().optional(),
      collectionShare: z.number(), // percent, 0–100
      representedWriters: z.array(z.string()),
    }),
  ),
  totalShares: z.number(), // THE number (percent, 0–100)
  matchedRecordings: z.array(
    z.object({
      artist: z.string(),
      title: z.string(),
      isrc: z.string().optional(),
      dsp: z.string(),
      label: z.string().optional(),
    }),
  ),
  sourceUrl: z.string(),
  snapshotPath: z.string(), // stored HTML/screenshot for provenance
  fetchedAt: z.string(),
});
export type MlcWork = z.infer<typeof MlcWorkSchema>;

export const GapKindSchema = z.enum([
  'partial_shares',
  'missing_writer_ipi',
  'writer_no_publisher',
  'work_not_registered',
  'durp_unmatched_hit',
  'soundexchange_unregistered',
  'pro_not_found',
]);
export type GapKind = z.infer<typeof GapKindSchema>;

export const GapSchema = z.object({
  kind: GapKindSchema,
  severity: z.enum(['critical', 'warning', 'info']),
  workRef: z.string().optional(), // mlcSongCode
  detail: z.string(), // deterministic template, not LLM text
  evidence: z.object({
    url: z.string(),
    snapshotPath: z.string(),
  }),
});
export type Gap = z.infer<typeof GapSchema>;

export const EstimateSchema = z.object({
  workRef: z.string(),
  method: z.string(), // printed verbatim in the report
  usStreamEstimate: z.object({ low: z.number(), high: z.number() }),
  unclaimedShare: z.number(), // e.g. 0.5
  accruedUsd: z.object({ low: z.number(), high: z.number() }),
  assumptions: z.array(z.string()),
});
export type Estimate = z.infer<typeof EstimateSchema>;

export const LeakReportSchema = z.object({
  scanId: z.string(),
  artist: CanonicalArtistSchema,
  works: z.array(MlcWorkSchema),
  gaps: z.array(GapSchema),
  estimates: z.array(EstimateSchema),
  leakScore: z.number().min(0).max(100), // deterministic (§6)
  generatedAt: z.string(),
  reportUrl: z.string(),
});
export type LeakReport = z.infer<typeof LeakReportSchema>;
