// Gap-engine tests against the two frozen real-world fixtures whose gaps were
// validated by manual scans (spec §2): Shallipopi "Speedometer" and
// Rema Namakula "Muchuzi". The suite never touches the network.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectUnregisteredTracks,
  detectWorkGaps,
  leakScore,
  verifyWorksByIsrc,
} from '../src/gap-engine/index.js';
import { MlcWorkSchema, type CanonicalArtist, type MlcWork } from '../src/types.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'works');
const speedometer: MlcWork = MlcWorkSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'speedometer-shallipopi.json'), 'utf8')),
);
const muchuzi: MlcWork = MlcWorkSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'muchuzi-rema.json'), 'utf8')),
);

const speedometerIsrc = speedometer.matchedRecordings.find((r) => r.isrc)!.isrc!;

function artistWith(tracks: { title: string; isrcs: string[]; streams?: number }[]): CanonicalArtist {
  return {
    queryName: 'Shallipopi',
    resolvedName: 'Shallipopi',
    aliases: ['Crown Uzamah'],
    tracks: tracks.map((t) => ({
      title: t.title,
      isrcs: t.isrcs,
      streams: t.streams ? [{ source: 'youtube' as const, count: t.streams, asOf: '2026-07-10' }] : [],
    })),
    disambiguation: { candidates: [], confidence: 'high', notes: '' },
  };
}

describe('ISRC verification (non-negotiable 2, the Rema lesson)', () => {
  it('includes a work when a matched-recording ISRC is in the canonical catalog', () => {
    const artist = artistWith([{ title: 'Speedometer', isrcs: [speedometerIsrc] }]);
    const { verified, unverified } = verifyWorksByIsrc([speedometer], artist);
    expect(verified).toHaveLength(1);
    expect(unverified).toHaveLength(0);
  });

  it('excludes a work with no ISRC intersection — never guesses on name alone', () => {
    const artist = artistWith([{ title: 'Speedometer', isrcs: ['XX0000000000'] }]);
    const { verified, unverified } = verifyWorksByIsrc([speedometer], artist);
    expect(verified).toHaveLength(0);
    expect(unverified).toHaveLength(1);
  });
});

describe('Speedometer (Shallipopi) — validated gaps', () => {
  const gaps = detectWorkGaps(speedometer);

  it('flags 50% partial shares as critical', () => {
    const g = gaps.find((x) => x.kind === 'partial_shares');
    expect(g?.severity).toBe('critical');
    expect(g?.detail).toContain('50%');
    expect(g?.workRef).toBe('SB5VH7');
  });

  it('flags Saheeb Haheeb as writer with no publisher (critical)', () => {
    const g = gaps.filter((x) => x.kind === 'writer_no_publisher');
    expect(g).toHaveLength(1);
    expect(g[0].detail).toContain('SAHEEB HAHEEB');
  });

  it('flags Crown Uzamah (Shallipopi) missing IPI as warning', () => {
    const g = gaps.filter((x) => x.kind === 'missing_writer_ipi');
    expect(g).toHaveLength(1);
    expect(g[0].detail).toContain('CROWN UZAMAH');
    expect(g[0].severity).toBe('warning');
  });

  it('every gap carries evidence (non-negotiable 3)', () => {
    for (const g of gaps) {
      expect(g.evidence.url).toMatch(/^https:\/\/portal\.themlc\.com/);
      expect(g.evidence.snapshotPath).toBeTruthy();
    }
  });

  it('is deterministic — same input, same verdicts', () => {
    expect(detectWorkGaps(speedometer)).toEqual(gaps);
  });
});

describe('Muchuzi (Rema Namakula) — even administered catalogs leak', () => {
  const gaps = detectWorkGaps(muchuzi);

  it('flags 30% partial shares as critical', () => {
    const g = gaps.find((x) => x.kind === 'partial_shares');
    expect(g?.severity).toBe('critical');
    expect(g?.detail).toContain('30%');
  });

  it('does not flag writer_no_publisher — Songtrust represents both writers', () => {
    expect(gaps.filter((x) => x.kind === 'writer_no_publisher')).toHaveLength(0);
  });

  it('flags Musuuza Edirisah missing IPI as warning', () => {
    const g = gaps.filter((x) => x.kind === 'missing_writer_ipi');
    expect(g).toHaveLength(1);
    expect(g[0].detail).toContain('MUSUUZA EDIRISAH');
  });
});

describe('fully registered works (the BENIN BOYS / mega-artist artifact)', () => {
  // Same work, but with 100% of shares registered: a writer missing from the
  // represented list is an MLC data-linkage artifact, not money going unpaid.
  const fullShares: MlcWork = { ...speedometer, totalShares: 100 };
  const gaps = detectWorkGaps(fullShares);

  it('downgrades writer_no_publisher to warning at 100% shares', () => {
    const g = gaps.filter((x) => x.kind === 'writer_no_publisher');
    expect(g).toHaveLength(1);
    expect(g[0].severity).toBe('warning');
  });

  it('does not flag partial_shares at 100%', () => {
    expect(gaps.find((x) => x.kind === 'partial_shares')).toBeUndefined();
  });

  it('count-mode leak score weighs warning-only works at 25%', () => {
    const artist = artistWith([{ title: 'Speedometer', isrcs: [speedometerIsrc] }]);
    expect(leakScore(gaps, [fullShares], artist)).toBe(25);
  });
});

describe('unregistered catalog tracks', () => {
  const evidence = { url: 'https://portal.themlc.com/search#work', snapshotPath: 'x' };

  it('flags a track whose ISRCs match no verified work as 100% unregistered', () => {
    const artist = artistWith([
      { title: 'Speedometer', isrcs: [speedometerIsrc] },
      { title: 'Ghost Song', isrcs: ['NG0000000001'] },
    ]);
    const gaps = detectUnregisteredTracks(artist, [speedometer], () => evidence);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe('work_not_registered');
    expect(gaps[0].detail).toContain('Ghost Song');
  });

  it('stays silent on tracks without ISRCs — no verification, no claim', () => {
    const artist = artistWith([{ title: 'No ISRC Track', isrcs: [] }]);
    const gaps = detectUnregisteredTracks(artist, [speedometer], () => evidence);
    expect(gaps).toHaveLength(0);
  });

  it('downgrades recent releases to warning — registration lag, not a leak', () => {
    const now = Date.parse('2026-07-23');
    const artist = artistWith([
      { title: 'Fresh Cut', isrcs: ['NG0000000003'] },
      { title: 'Old Miss', isrcs: ['NG0000000004'] },
    ]);
    artist.tracks[0].releaseDate = '2025-12-05'; // ~7.5 months old
    artist.tracks[1].releaseDate = '2023-11-10';
    const gaps = detectUnregisteredTracks(artist, [speedometer], () => evidence, { now });
    const fresh = gaps.find((g) => g.detail.includes('Fresh Cut'))!;
    const old = gaps.find((g) => g.detail.includes('Old Miss'))!;
    expect(fresh.severity).toBe('warning');
    expect(fresh.detail).toContain('registration and matching lag');
    expect(old.severity).toBe('critical');
  });

  it('sampled previews never claim absence — warning + pointer to full scan', () => {
    const artist = artistWith([{ title: 'Deep Cut', isrcs: ['NG0000000005'] }]);
    const gaps = detectUnregisteredTracks(artist, [speedometer], () => evidence, {
      sampled: true,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe('warning');
    expect(gaps[0].detail).toContain('run the full leak scan');
  });

  it('near-full registration (≥95%) downgrades work gaps to warnings', () => {
    const nearFull = { ...speedometer, totalShares: 99.25 };
    const gaps = detectWorkGaps(nearFull);
    expect(gaps.find((g) => g.kind === 'partial_shares')?.severity).toBe('warning');
    expect(gaps.find((g) => g.kind === 'writer_no_publisher')?.severity).toBe('warning');
  });
});

describe('leak score', () => {
  it('is 0 for a clean catalog', () => {
    const artist = artistWith([{ title: 'Speedometer', isrcs: [speedometerIsrc], streams: 1000 }]);
    expect(leakScore([], [speedometer], artist)).toBe(0);
  });

  it('weights by affected stream volume', () => {
    const artist = artistWith([
      { title: 'Speedometer', isrcs: [speedometerIsrc], streams: 8_000_000 },
      { title: 'Clean Hit', isrcs: ['NG0000000002'], streams: 2_000_000 },
    ]);
    const gaps = detectWorkGaps(speedometer);
    // 8M of 10M streams affected by critical gaps → 80
    expect(leakScore(gaps, [speedometer], artist)).toBe(80);
  });

  it('falls back to work-count fraction without stream data', () => {
    const artist = artistWith([{ title: 'Speedometer', isrcs: [speedometerIsrc] }]);
    const gaps = detectWorkGaps(speedometer);
    expect(leakScore(gaps, [speedometer], artist)).toBe(100);
  });
});
