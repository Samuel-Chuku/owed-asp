import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateWork, MECHANICAL_RATE_BAND, US_SHARE_BAND } from '../src/estimator/index.js';
import { MlcWorkSchema, type CanonicalTrack, type MlcWork } from '../src/types.js';

const speedometer: MlcWork = MlcWorkSchema.parse(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'fixtures', 'works', 'speedometer-shallipopi.json'), 'utf8'),
  ),
);

const track = (streams: number): CanonicalTrack => ({
  title: 'Speedometer',
  isrcs: ['NGA7Q2327303'],
  streams: streams ? [{ source: 'youtube', count: streams, asOf: '2026-07-10' }] : [],
});

describe('estimator', () => {
  it('produces a range from the documented bands (Speedometer, 50% unclaimed)', () => {
    const est = estimateWork(speedometer, track(10_000_000))!;
    // low: 10M × 0.25 × 0.0006 × 0.5 = 750 ; high: 10M × 0.40 × 0.0009 × 0.5 = 1800
    expect(est.accruedUsd.low).toBeCloseTo(
      10_000_000 * US_SHARE_BAND.low * MECHANICAL_RATE_BAND.low * 0.5,
      2,
    );
    expect(est.accruedUsd.high).toBeCloseTo(
      10_000_000 * US_SHARE_BAND.high * MECHANICAL_RATE_BAND.high * 0.5,
      2,
    );
    expect(est.accruedUsd.low).toBeLessThan(est.accruedUsd.high);
    expect(est.unclaimedShare).toBe(0.5);
  });

  it('prints the method and every assumption (non-negotiable 4)', () => {
    const est = estimateWork(speedometer, track(1_000_000))!;
    expect(est.method).toContain('CRB Phonorecords IV');
    expect(est.method).toContain('Only filing a claim with The MLC reveals the true held balance.');
    expect(est.assumptions.length).toBeGreaterThanOrEqual(4);
  });

  it('returns null without stream data — no data, no dollar figure', () => {
    expect(estimateWork(speedometer, track(0))).toBeNull();
  });

  it('returns null for fully registered works', () => {
    const full = { ...speedometer, totalShares: 100 };
    expect(estimateWork(full, track(1_000_000))).toBeNull();
  });
});
