// Full scan pipeline, runnable from the terminal for testing:
//   npx tsx scripts/scan.ts "<artist name>" [--max-tracks N]
// Thin CLI over src/pipeline/scan.ts (the same code the MCP server runs).
// Respectful by design: 3s between MLC calls, 7-day work cache — a re-run on
// the same artist is instant and hits the network zero times.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultMlcClient, runScan } from '../src/pipeline/scan.js';

const ROOT = join(import.meta.dirname, '..');
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  // no .env — run without stream estimates
}

const args = process.argv.slice(2);
const artistName = args.filter((a) => !a.startsWith('--'))[0];
const maxTracksArg = args.indexOf('--max-tracks');
const maxTracks = maxTracksArg >= 0 ? Number(args[maxTracksArg + 1]) : 25;
if (!artistName) {
  console.error('Usage: npx tsx scripts/scan.ts "<artist name>" [--max-tracks N]');
  process.exit(1);
}

async function main() {
  console.log(`\n■ OWED scan: ${artistName}\n`);
  const result = await runScan(artistName, {
    client: defaultMlcClient(ROOT),
    maxTracks,
    youtubeApiKey: process.env.YOUTUBE_API_KEY,
    youtubeCacheDir: join(ROOT, 'data', 'cache'),
    onProgress: (m) => console.log(`   ${m}`),
  });

  if (result.status === 'not_found') {
    console.log('✗ no artist found under that name.');
    return;
  }
  if (result.status === 'ambiguous') {
    console.log('! multiple plausible artists — a paid scan would require the caller to pick:');
    for (const c of result.candidates) {
      console.log(`   - ${c.name}${c.disambiguation ? ` (${c.disambiguation})` : ''} [${c.country ?? '??'}] score ${c.score}`);
    }
    return;
  }

  const { artist, works, unverifiedCount, gaps, estimates, leakScore } = result;
  console.log(`\n■ RESULT — leak score ${leakScore}/100`);
  console.log(`  registered works verified as ${artist.resolvedName}'s: ${works.length} (${unverifiedCount} name-matches excluded as unverifiable)`);
  for (const w of works) {
    console.log(`\n  ▸ "${w.title}" (${w.mlcSongCode}) — total registered shares: ${w.totalShares}% — ${w.matchedRecordings.length} matched recordings`);
    console.log(`    ${w.sourceUrl}`);
    for (const g of gaps.filter((g) => g.workRef === w.mlcSongCode)) {
      console.log(`    [${g.severity.toUpperCase()}] ${g.detail}`);
    }
    const est = estimates.find((e) => e.workRef === w.mlcSongCode);
    if (est) {
      console.log(`    [ESTIMATE] $${est.accruedUsd.low.toLocaleString()} – $${est.accruedUsd.high.toLocaleString()} accrued for the unclaimed ${est.unclaimedShare * 100}% (range, not a balance)`);
    }
  }
  const unregGaps = gaps.filter((g) => g.kind === 'work_not_registered');
  if (unregGaps.length) {
    console.log(`\n  ▸ catalog tracks with NO MLC registration found (${unregGaps.length}):`);
    for (const g of unregGaps) console.log(`    [${g.severity.toUpperCase()}] ${g.detail}`);
  }
  if (gaps.length === 0) console.log('  no gaps detected on the scanned titles.');
  console.log('\n  Disclaimer: not affiliated with The MLC. Registered-share percentages are');
  console.log('  publicly verifiable at the source URLs above; joining and claiming with The');
  console.log('  MLC is free.');

  const outDir = join(ROOT, 'data', 'scans');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${artistName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ artist, works, unverifiedCount, gaps, estimates, leakScore, generatedAt: result.generatedAt }, null, 2));
  console.log(`\n  full JSON: ${outPath}\n`);
}

main().catch((err) => {
  console.error('SCAN FAILED:', err);
  process.exit(1);
});
