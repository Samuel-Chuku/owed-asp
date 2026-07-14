// End-to-end dry run of the pipeline's front half against live data:
// resolve "Shallipopi" → canonical ISRC catalog → verify the Speedometer MLC
// work by ISRC intersection → run the gap engine. Expected: verification
// passes and the three validated gaps appear.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveArtist } from '../src/identity/index.js';
import { detectWorkGaps, verifyWorksByIsrc } from '../src/gap-engine/index.js';
import { MlcWorkSchema } from '../src/types.js';

const speedometer = MlcWorkSchema.parse(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'fixtures', 'works', 'speedometer-shallipopi.json'), 'utf8'),
  ),
);

async function main() {
  console.log('→ resolving "Shallipopi" via MusicBrainz …');
  const result = await resolveArtist('Shallipopi');
  if (result.status !== 'resolved') {
    console.log('RESULT:', JSON.stringify(result, null, 2).slice(0, 1500));
    return;
  }
  const artist = result.artist;
  const isrcCount = artist.tracks.reduce((s, t) => s + t.isrcs.length, 0);
  console.log(`✓ resolved: ${artist.resolvedName} (mbid ${artist.mbid})`);
  console.log(`  aliases: ${artist.aliases.join(', ') || '(none)'}`);
  console.log(`  confidence: ${artist.disambiguation.confidence}`);
  console.log(`  tracks: ${artist.tracks.length}, ISRCs: ${isrcCount}`);

  const { verified, unverified } = verifyWorksByIsrc([speedometer], artist);
  console.log(`\n→ ISRC verification: ${verified.length} verified, ${unverified.length} unverified`);
  if (verified.length === 0) {
    const workIsrcs = speedometer.matchedRecordings.filter((r) => r.isrc).slice(0, 8);
    console.log('  !! no intersection. Sample work ISRCs:', workIsrcs.map((r) => `${r.isrc}(${r.artist})`));
    const spTracks = artist.tracks.filter((t) => t.title.includes('SPEEDOMETER'));
    console.log('  Canonical SPEEDOMETER tracks:', JSON.stringify(spTracks));
    return;
  }

  console.log('\n→ gaps on verified works:');
  for (const work of verified) {
    for (const gap of detectWorkGaps(work)) {
      console.log(`  [${gap.severity}] ${gap.kind}: ${gap.detail.slice(0, 140)}`);
    }
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
