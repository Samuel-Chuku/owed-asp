// Estimator — §5 step 5. Pure function; every assumption is printed in the
// output (non-negotiable 4: always ranges, method shown verbatim, never
// implied certainty about held balances).

import type { CanonicalTrack, Estimate, MlcWork } from '../types.js';

/**
 * CRB statutory mechanical rate for interactive streaming, Phonorecords IV
 * (2023–2027): the all-in royalty pool is the greater of 15.35% of service
 * revenue or a per-subscriber floor; the widely used per-stream effective
 * mechanical rate lands at roughly $0.0006–$0.0009. We use that band.
 * Source: 37 CFR §385 (Phonorecords IV), www.crb.gov.
 */
export const MECHANICAL_RATE_BAND = { low: 0.0006, high: 0.0009 };

/**
 * Share of global streams attributable to US listeners for Afrobeats/African
 * catalogs — a visible per-scan assumption, not a fact (spec §5 step 5).
 */
export const US_SHARE_BAND = { low: 0.25, high: 0.4 };

/** Sum of estimate ranges for the report's money clock. Pure. */
export function sumAccrued(estimates: Estimate[]): { low: number; high: number } | null {
  if (estimates.length === 0) return null;
  return {
    low: Math.round(estimates.reduce((s, e) => s + e.accruedUsd.low, 0)),
    high: Math.round(estimates.reduce((s, e) => s + e.accruedUsd.high, 0)),
  };
}

/**
 * Ongoing monthly leak: total accrued mid-range ÷ months since the earliest
 * affected release. Pure; null when there is nothing to divide.
 */
export function monthlyLeak(
  estimates: Estimate[],
  earliestReleaseIso: string | undefined,
  asOf: Date = new Date(),
): number | null {
  const total = sumAccrued(estimates);
  if (!total || !earliestReleaseIso) return null;
  const start = Date.parse(earliestReleaseIso);
  if (Number.isNaN(start)) return null;
  const months = Math.max(1, (asOf.getTime() - start) / (30.44 * 24 * 3600 * 1000));
  return Math.round((total.low + total.high) / 2 / months);
}

export function estimateWork(
  work: MlcWork,
  track: CanonicalTrack,
  opts: { usShareBand?: { low: number; high: number } } = {},
): Estimate | null {
  const unclaimedShare = Math.max(0, (100 - work.totalShares) / 100);
  if (unclaimedShare === 0) return null;

  const globalStreams = Math.max(0, ...track.streams.map((s) => s.count), 0);
  if (globalStreams === 0) return null; // no stream data → no dollar estimate, ever

  const usShare = opts.usShareBand ?? US_SHARE_BAND;
  const usLow = globalStreams * usShare.low;
  const usHigh = globalStreams * usShare.high;

  const round = (n: number) => Math.round(n * 100) / 100;
  const accrued = {
    low: round(usLow * MECHANICAL_RATE_BAND.low * unclaimedShare),
    high: round(usHigh * MECHANICAL_RATE_BAND.high * unclaimedShare),
  };

  const streamSources = [...new Set(track.streams.map((s) => s.source))].join(', ');
  return {
    workRef: work.mlcSongCode,
    method:
      `US stream estimate = reported plays (${globalStreams.toLocaleString('en-US')}, source: ${streamSources}) ` +
      `× assumed US listening share (${usShare.low * 100}–${usShare.high * 100}%). ` +
      `Accrued estimate = US streams × effective US mechanical rate band ` +
      `($${MECHANICAL_RATE_BAND.low}–$${MECHANICAL_RATE_BAND.high}/stream, CRB Phonorecords IV, 37 CFR §385) ` +
      `× unregistered share (${unclaimedShare * 100}%). ` +
      `Only filing a claim with The MLC reveals the true held balance.`,
    usStreamEstimate: { low: Math.round(usLow), high: Math.round(usHigh) },
    unclaimedShare,
    accruedUsd: accrued,
    assumptions: [
      `US listeners account for ${usShare.low * 100}–${usShare.high * 100}% of this track's total plays.`,
      `Effective US mechanical royalty per interactive stream is $${MECHANICAL_RATE_BAND.low}–$${MECHANICAL_RATE_BAND.high} (CRB Phonorecords IV band).`,
      `Play counts are as reported by public platform APIs (${streamSources}) and may lag real-time totals.`,
      `The ${unclaimedShare * 100}% unregistered share is publicly verifiable on the MLC work page; the dollar figure is an estimate, not a held-balance statement.`,
    ],
  };
}
