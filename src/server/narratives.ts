// Narrative writer — report-rendering-instructions.md, deliverable 2.
//
// Hard constraints (from the instructions, applied verbatim):
// - Input is ONLY the gaps and estimates JSON. Never introduce a fact not
//   present in it.
// - Write for a musician with zero industry knowledge. The words IPI, ISWC,
//   ISRC, and "mechanical" may not appear outside the appendix; say
//   "songwriter royalties" and "the US registry".
// - Every "who" line answers, in order: what's wrong → whose money → what
//   happens to it.
// - Never state a dollar figure in prose; money appears only in the estimate
//   box as a range.
// - Never write "you are owed" — write "held", "unclaimed", "not reaching
//   anyone".
// - Verdict sentence pattern: "Money is being collected on {N} of your songs
//   that isn't reaching anyone." If N=0: "Your catalog is fully registered.
//   Royalties are flowing correctly."
//
// v1 is deterministic templating over the gap JSON (which satisfies every
// constraint by construction). An LLM pass behind OPENROUTER_API_KEY can
// replace the phrasing later; it must inherit these exact rules.

import type { Estimate, Gap } from '../types.js';

export type Narratives = {
  /** Count of songs money is being collected on without reaching anyone. */
  affectedCount: number;
  /** H1 with {N} already substituted; template wraps the em itself. */
  verdictH1: { pre: string; em: string; post: string };
  verdictParagraph: string;
  /** Per registered work (keyed by mlcSongCode). */
  whoByWork: Record<string, string>;
  /** Per unregistered track (keyed by track title). */
  whoByUnregistered: Record<string, string>;
};

const titleCase = (name: string): string =>
  name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function joinNames(names: string[]): string {
  const pretty = names.map(titleCase);
  if (pretty.length <= 1) return pretty[0] ?? '';
  return `${pretty.slice(0, -1).join(', ')} and ${pretty[pretty.length - 1]}`;
}

export function writeNarratives(
  gaps: Gap[],
  _estimates: Estimate[],
  opts: { affectedCount?: number } = {},
): Narratives {
  const byWork = new Map<string, Gap[]>();
  for (const g of gaps) {
    if (!g.workRef) continue;
    if (!byWork.has(g.workRef)) byWork.set(g.workRef, []);
    byWork.get(g.workRef)!.push(g);
  }
  const unregGaps = gaps.filter((g) => g.kind === 'work_not_registered');

  const criticalWorkCount = [...byWork.values()].filter((gs) =>
    gs.some((g) => g.severity === 'critical'),
  ).length;
  // Default is works+unregistered; the renderer passes the distinct affected-
  // track count (gap-engine affectedTrackCount) so the verdict never exceeds
  // the scanned-track count shown in the eyebrow.
  const affectedCount = opts.affectedCount ?? criticalWorkCount + unregGaps.length;

  const whoByWork: Record<string, string> = {};
  for (const [songCode, workGaps] of byWork) {
    const partial = workGaps.find((g) => g.kind === 'partial_shares');
    const pct = partial ? /only (\d+(?:\.\d+)?)%/.exec(partial.detail)?.[1] : undefined;
    const noPubNames = workGaps
      .filter((g) => g.kind === 'writer_no_publisher')
      .map((g) => /Writer (.+?) \(/.exec(g.detail)?.[1])
      .filter((n): n is string => !!n);
    const noIpiNames = workGaps
      .filter((g) => g.kind === 'missing_writer_ipi')
      .map((g) => /Writer (.+?) on/.exec(g.detail)?.[1])
      .filter((n): n is string => !!n);

    let who: string;
    const hasHave = noPubNames.length > 1 ? 'have' : 'has';
    if (pct && noPubNames.length) {
      who = `Only ${Math.round(Number(pct))}% of this song's ownership is registered. <b>${joinNames(noPubNames)}</b> ${hasHave} no one registered to collect for them — their share of every US songwriter dollar is being held, not paid out.`;
    } else if (pct) {
      who = `Only ${Math.round(Number(pct))}% of this song's ownership is registered. The remaining <b>${100 - Math.round(Number(pct))}%</b> of its US songwriter royalties is being held, not reaching anyone.`;
    } else if (noPubNames.length) {
      who = `<b>${joinNames(noPubNames)}</b> ${hasHave} no one registered to collect on this song. Their share of its US songwriter royalties may not be reaching them.`;
    } else if (noIpiNames.length) {
      who = `Registration covers the full song, but ${joinNames(noIpiNames)} is missing a global songwriter ID number. Matching across borders can silently fail, so part of the royalties can go astray.`;
    } else {
      who = 'Registered at 100%. Royalties are flowing correctly. Nothing to do here.';
    }
    whoByWork[songCode] = who;
  }

  const whoByUnregistered: Record<string, string> = {};
  for (const g of unregGaps) {
    const title = /^"(.+?)"/.exec(g.detail)?.[1] ?? 'This song';
    whoByUnregistered[title] =
      'This song does not appear in the US songwriter registry at all. <b>100% of its songwriter royalties</b> are unclaimed.';
  }

  return {
    affectedCount,
    verdictH1:
      affectedCount > 0
        ? {
            pre: 'Money is being collected on ',
            em: `${affectedCount} of your songs`,
            post: " that isn't reaching anyone.",
          }
        : { pre: 'Your catalog is fully registered. ', em: 'Royalties are flowing correctly.', post: '' },
    verdictParagraph:
      affectedCount > 0
        ? 'US streaming services pay songwriter royalties for these songs every month. Because part of the ownership was never registered, that share is being held in the US instead of paid out. It stays claimable — but unclaimed money is eventually redistributed to major publishers.'
        : 'Every scanned song is registered with its full ownership. This page is your receipt — each row below links to the public record.',
    whoByWork,
    whoByUnregistered,
  };
}
