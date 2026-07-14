// Fixture-first development (§8): fetch the two manually-validated works —
// Shallipopi "Speedometer" and Rema Namakula "Muchuzi" — through the real
// client and freeze them as test fixtures for the gap engine.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MlcClient, toMlcWork } from '../src/crawlers/mlc.js';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'fixtures', 'works');
mkdirSync(FIXTURES, { recursive: true });

const client = new MlcClient({
  snapshotDir: join(ROOT, 'data', 'snapshots'),
  cacheDir: join(ROOT, 'data', 'cache'),
});

const TARGETS = [
  { fixture: 'speedometer-shallipopi', title: 'Speedometer', artistContains: 'SHALLIPOPI' },
  { fixture: 'muchuzi-rema', title: 'Muchuzi', artistContains: 'REMA' },
];

async function main() {
  for (const t of TARGETS) {
    console.log(`\n=== ${t.title} (${t.artistContains}) ===`);
    let found = null as null | { raw: any; snapshotPath: string };
    for (let page = 0; page < 5 && !found; page++) {
      const res = await client.searchWorksByTitle(t.title, page, 25);
      console.log(`  page ${page}: ${res.works.length} works (total ${res.totalElements})`);
      for (const w of res.works) {
        const artists = (w.matchedRecordings?.recordings ?? []).map((r) =>
          r.recordingDisplayArtistName?.toUpperCase(),
        );
        if (artists.some((a) => a?.includes(t.artistContains))) {
          found = { raw: w, snapshotPath: res.snapshotPath };
          break;
        }
      }
      if (res.works.length < 25) break;
    }
    if (!found) {
      console.log(`  !! not found by matched-recording artist "${t.artistContains}"`);
      continue;
    }
    const { raw, snapshotPath } = found;
    console.log(`  ✓ songCode=${raw.songCode} totalKnownShares=${raw.totalKnownShares} id=${raw.id}`);
    const { recordings } = await client.fetchMatchedRecordings(raw.songCode);
    console.log(`  ✓ ${recordings.length} matched recordings fetched`);
    const work = toMlcWork(raw, recordings, snapshotPath);
    writeFileSync(join(FIXTURES, `${t.fixture}.json`), JSON.stringify(work, null, 2));
    writeFileSync(join(FIXTURES, `${t.fixture}.raw.json`), JSON.stringify({ raw, recordings }, null, 2));
    console.log(`  ✓ fixture written: fixtures/works/${t.fixture}.json`);
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
