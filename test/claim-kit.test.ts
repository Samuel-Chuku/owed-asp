import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateClaimKit } from '../src/claim-kit/index.js';
import { detectWorkGaps } from '../src/gap-engine/index.js';
import { MlcWorkSchema, type MlcWork } from '../src/types.js';
import type { ScanResult } from '../src/pipeline/scan.js';

const speedometer: MlcWork = MlcWorkSchema.parse(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'fixtures', 'works', 'speedometer-shallipopi.json'), 'utf8'),
  ),
);

const result: Extract<ScanResult, { status: 'complete' }> = {
  status: 'complete',
  artist: {
    queryName: 'Shallipopi',
    resolvedName: 'Shallipopi',
    aliases: ['Crown Uzama'],
    tracks: [],
    disambiguation: { candidates: [], confidence: 'high', notes: '' },
  },
  works: [speedometer],
  unverifiedCount: 0,
  gaps: [
    ...detectWorkGaps(speedometer),
    {
      kind: 'work_not_registered',
      severity: 'critical',
      detail: `"HOTEL LOBBY" (ISRC USUM72317893) has no registration in the MLC database under Shallipopi's verified catalog. 100% of its US mechanical royalties accrue as unclaimed.`,
      evidence: { url: 'https://portal.themlc.com/search#work', snapshotPath: 'x' },
    },
  ],
  estimates: [],
  leakScore: 100,
  generatedAt: '2026-07-11T00:00:00.000Z',
};

describe('claim kit generator', () => {
  const kit = generateClaimKit(result);

  it('always starts with free MLC membership', () => {
    expect(kit.steps[0].title).toContain('Join The MLC (free)');
  });

  it('lists the partial-shares work with its song code and evidence URL', () => {
    const claimStep = kit.steps.find((s) => s.title.includes('Claim your unregistered shares'))!;
    expect(claimStep.actions.join(' ')).toContain('SB5VH7');
    expect(claimStep.actions.join(' ')).toContain('50% registered');
    expect(claimStep.actions.join(' ')).toContain('portal.themlc.com/catalog/work');
  });

  it('lists unregistered works with their ISRCs', () => {
    const regStep = kit.steps.find((s) => s.title.includes('missing entirely'))!;
    expect(regStep.actions.join(' ')).toContain('HOTEL LOBBY');
    expect(regStep.actions.join(' ')).toContain('USUM72317893');
  });

  it('includes the IPI step for writers flagged without one', () => {
    const ipiStep = kit.steps.find((s) => s.title.includes('IPI'))!;
    expect(ipiStep.title).toContain('CROWN UZAMAH');
  });

  it('carries the anti-scam framing and disclaimer (non-negotiables)', () => {
    expect(kit.intro).toContain('free to do yourself');
    expect(kit.disclaimer).toContain('not legal or tax advice');
    expect(kit.disclaimer).toContain('not affiliated with The MLC');
    expect(kit.timeline).toContain('only the MLC can state the exact held amount');
  });

  it('is deterministic apart from the timestamp', () => {
    const again = generateClaimKit(result);
    expect({ ...again, generatedAt: '' }).toEqual({ ...kit, generatedAt: '' });
  });
});
