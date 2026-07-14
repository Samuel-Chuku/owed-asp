// Report rendering test — report-rendering-instructions.md deliverable 3:
// renders fixtures/speedometer-scan.json (a real scan output) and snapshots
// the output, plus assertions on the instructions' hard rules.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderReport } from '../src/server/report.js';
import { writeNarratives } from '../src/server/narratives.js';
import { LeakReportSchema, type LeakReport } from '../src/types.js';

const report: LeakReport = LeakReportSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'speedometer-scan.json'), 'utf8')),
);
const html = renderReport(report);

describe('renderReport (leak-report-template binding)', () => {
  it('matches the rendered snapshot', () => {
    expect(html).toMatchSnapshot();
  });

  it('renders the verdict sentence pattern with the affected count', () => {
    expect(html).toMatch(/Money is being collected on <em>\d+ of your songs<\/em> that isn't reaching anyone\./);
  });

  it('never uses registry jargon outside the appendix', () => {
    const [beforeAppendix] = html.split('<details>');
    for (const word of ['IPI', 'ISWC', 'mechanical']) {
      expect(beforeAppendix.replace(/catalog verified by ISRC[^<]*/, '')).not.toContain(word);
    }
  });

  it('never writes "you are owed" in prose', () => {
    expect(html.toLowerCase()).not.toContain('you are owed');
  });

  it('renders em-dash clock cells (never placeholder numbers) when there are no estimates', () => {
    expect(html).not.toContain('class="est"');
    expect(html).toContain('Est. accrued to date');
    expect(html).toMatch(/<div class="num">—<\/div>/);
    expect(html).toContain('Cost to claim (MLC is free)'); // the trust line stays
  });

  it('keeps the verdict count within the scanned-track count', () => {
    const m = /<em>(\d+) of your songs<\/em>/.exec(html)!;
    expect(Number(m[1])).toBeLessThanOrEqual(report.artist.tracks.length);
  });

  it('counts unregistered tracks in the split bar', () => {
    // 16 unregistered tracks must drag the unclaimed side well above the
    // works-only figure (which was 6%).
    const m = /class="leaking" style="width:(\d+)%">\1%/.exec(html)!;
    expect(Number(m[1])).toBeGreaterThanOrEqual(15);
  });

  it('keeps the static disclaimers verbatim', () => {
    expect(html).toContain('not affiliated with The MLC. Claiming through The MLC is free. This report is educational guidance, not legal advice.');
    expect(html).toContain('Ranges, not balances');
  });

  it('escapes scraped strings', () => {
    const hostile: LeakReport = {
      ...report,
      artist: { ...report.artist, resolvedName: '<script>alert(1)</script>' },
    };
    const out = renderReport(hostile);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders evidence links with the song code', () => {
    for (const w of report.works) {
      expect(html).toContain(`song code ${w.mlcSongCode}`);
    }
  });

  it('renders the medium-confidence banner only when confidence is not high', () => {
    expect(html).not.toContain('verify the songs below are yours');
    const medium: LeakReport = {
      ...report,
      artist: {
        ...report.artist,
        disambiguation: { ...report.artist.disambiguation, confidence: 'medium' },
      },
    };
    expect(renderReport(medium)).toContain('verify the songs below are yours');
  });
});

describe('writeNarratives rules', () => {
  const n = writeNarratives(report.gaps, []);

  it('every who-line avoids dollar figures', () => {
    for (const who of [...Object.values(n.whoByWork), ...Object.values(n.whoByUnregistered)]) {
      expect(who).not.toMatch(/\$\d/);
    }
  });

  it('clean verdict when no gaps', () => {
    const clean = writeNarratives([], []);
    expect(clean.verdictH1.pre).toContain('Your catalog is fully registered.');
  });
});
