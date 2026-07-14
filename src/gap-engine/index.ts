// Gap engine — §5 step 3/4 of the spec. Pure functions only: same inputs,
// same verdicts, every run. The LLM never gets a vote here (non-negotiable 1).

import type { CanonicalArtist, Gap, MlcWork } from '../types.js';

/**
 * Non-negotiable 2 (the Rema lesson): a work only enters the report if at
 * least one of its matched-recording ISRCs appears in the artist's canonical
 * catalog. Everything else goes to the "could not verify as yours" appendix.
 */
export function verifyWorksByIsrc(
  works: MlcWork[],
  artist: CanonicalArtist,
): { verified: MlcWork[]; unverified: MlcWork[] } {
  const artistIsrcs = new Set(
    artist.tracks.flatMap((t) => t.isrcs).map((i) => i.toUpperCase()),
  );
  const verified: MlcWork[] = [];
  const unverified: MlcWork[] = [];
  for (const work of works) {
    const hit = work.matchedRecordings.some(
      (r) => r.isrc && artistIsrcs.has(r.isrc.toUpperCase()),
    );
    (hit ? verified : unverified).push(work);
  }
  return { verified, unverified };
}

/** Gaps on a single ISRC-verified registered work. */
export function detectWorkGaps(work: MlcWork): Gap[] {
  const gaps: Gap[] = [];
  const evidence = { url: work.sourceUrl, snapshotPath: work.snapshotPath };

  if (work.totalShares < 100) {
    gaps.push({
      kind: 'partial_shares',
      severity: 'critical',
      workRef: work.mlcSongCode,
      detail: `"${work.title}" (MLC song code ${work.mlcSongCode}) has only ${work.totalShares}% of ownership shares registered. The remaining ${100 - work.totalShares}% of mechanical royalties on ${work.matchedRecordings.length} matched recordings accrues as unclaimed.`,
      evidence,
    });
  }

  const representedNames = new Set(
    work.publishers.flatMap((p) => p.representedWriters).map((n) => n.toUpperCase()),
  );
  for (const writer of work.writers) {
    if (!representedNames.has(writer.name.toUpperCase())) {
      gaps.push({
        kind: 'writer_no_publisher',
        severity: 'critical',
        workRef: work.mlcSongCode,
        detail: `Writer ${writer.name} (${writer.role}) on "${work.title}" has no publisher or administrator collecting on their behalf. Their share of mechanical royalties is not being paid out.`,
        evidence,
      });
    }
    if (!writer.ipi) {
      gaps.push({
        kind: 'missing_writer_ipi',
        severity: 'warning',
        workRef: work.mlcSongCode,
        detail: `Writer ${writer.name} on "${work.title}" has no IPI number registered. Missing IPI makes royalty matching across societies unreliable.`,
        evidence,
      });
    }
  }

  return gaps;
}

/**
 * Catalog tracks with no ISRC-verified MLC work at all: 100% unregistered.
 * Only flags tracks that carry at least one ISRC (otherwise we cannot apply
 * the verification rule, so we stay silent rather than guess).
 */
export function detectUnregisteredTracks(
  artist: CanonicalArtist,
  verifiedWorks: MlcWork[],
  evidenceFor: (trackTitle: string) => { url: string; snapshotPath: string },
): Gap[] {
  const registeredIsrcs = new Set(
    verifiedWorks
      .flatMap((w) => w.matchedRecordings)
      .map((r) => r.isrc?.toUpperCase())
      .filter(Boolean),
  );
  const gaps: Gap[] = [];
  for (const track of artist.tracks) {
    if (track.isrcs.length === 0) continue;
    const registered = track.isrcs.some((i) => registeredIsrcs.has(i.toUpperCase()));
    if (!registered) {
      gaps.push({
        kind: 'work_not_registered',
        severity: 'critical',
        detail: `"${track.title}" (ISRC ${track.isrcs[0]}) has no registration in the MLC database under ${artist.resolvedName}'s verified catalog. 100% of its US mechanical royalties accrue as unclaimed.`,
        evidence: evidenceFor(track.title),
      });
    }
  }
  return gaps;
}

/**
 * Catalog split for the report's signature bar: claimed vs unclaimed share of
 * registered US songwriter royalties, weighted by streaming volume. Includes
 * unregistered catalog tracks at 0% claimed (user decision, Jul 11 — a bar
 * that excludes them undersells the finding). Falls back to matched-recording
 * counts as the volume proxy when no stream data exists; unregistered tracks
 * have no recordings count, so they take the catalog-average work weight
 * (unknown volume → assume average). Pure; returns integers that sum to 100.
 */
export function catalogSplit(
  works: MlcWork[],
  artist: CanonicalArtist,
  unregisteredTitles: string[] = [],
): { claimedPct: number; unclaimedPct: number } {
  if (works.length === 0 && unregisteredTitles.length === 0) {
    return { claimedPct: 100, unclaimedPct: 0 };
  }
  const streamsOf = (title: string): number => {
    const t = artist.tracks.find((tr) => tr.title.toUpperCase() === title.toUpperCase());
    return t ? Math.max(0, ...t.streams.map((s) => s.count), 0) : 0;
  };
  const hasStreams =
    works.some((w) => streamsOf(w.title) > 0) || unregisteredTitles.some((t) => streamsOf(t) > 0);
  let weighted = 0;
  let total = 0;
  for (const w of works) {
    const weight = hasStreams ? streamsOf(w.title) : Math.max(1, w.matchedRecordings.length);
    weighted += weight * (w.totalShares / 100);
    total += weight;
  }
  const avgWorkWeight =
    works.length > 0
      ? works.reduce((s, w) => s + Math.max(1, w.matchedRecordings.length), 0) / works.length
      : 1;
  for (const title of unregisteredTitles) {
    // 0% claimed → adds nothing to weighted
    total += hasStreams ? streamsOf(title) : avgWorkWeight;
  }
  const claimed = total === 0 ? 100 : Math.round(100 * (weighted / total));
  return { claimedPct: claimed, unclaimedPct: 100 - claimed };
}

/**
 * Count of distinct catalog tracks affected by critical findings: tracks
 * whose ISRCs land in a critically-gapped work, plus tracks with no
 * registration at all. Keeps the verdict's "{N} of your songs" consistent
 * with the scanned-track count in the eyebrow (user decision, Jul 11).
 */
export function affectedTrackCount(
  works: MlcWork[],
  gaps: Gap[],
  artist: CanonicalArtist,
): number {
  const criticalCodes = new Set(
    gaps.filter((g) => g.severity === 'critical' && g.workRef).map((g) => g.workRef),
  );
  const leakingIsrcs = new Set(
    works
      .filter((w) => criticalCodes.has(w.mlcSongCode))
      .flatMap((w) => w.matchedRecordings.map((r) => r.isrc?.toUpperCase()))
      .filter(Boolean),
  );
  let count = gaps.filter((g) => g.kind === 'work_not_registered').length;
  for (const t of artist.tracks) {
    if (t.isrcs.some((i) => leakingIsrcs.has(i.toUpperCase()))) count++;
  }
  return count;
}

/**
 * Leak score (§6): 100 × (stream volume of works affected by critical gaps ÷
 * total catalog stream volume), with warning-only works counting at 25%.
 * Falls back to work counts when no stream data exists. Deterministic.
 */
export function leakScore(
  gaps: Gap[],
  works: MlcWork[],
  artist: CanonicalArtist,
): number {
  const streamsOf = (title: string): number => {
    const t = artist.tracks.find((tr) => tr.title.toUpperCase() === title.toUpperCase());
    return t ? Math.max(0, ...t.streams.map((s) => s.count), 0) : 0;
  };

  const severityByWork = new Map<string, 'critical' | 'warning'>();
  for (const g of gaps) {
    if (!g.workRef) continue;
    if (g.severity === 'critical') severityByWork.set(g.workRef, 'critical');
    else if (g.severity === 'warning' && !severityByWork.has(g.workRef)) {
      severityByWork.set(g.workRef, 'warning');
    }
  }
  // Unregistered tracks are 100%-leaking by definition; weigh them as critical.
  const unregisteredTitles = gaps
    .filter((g) => g.kind === 'work_not_registered')
    .map((g) => /^"(.+?)"/.exec(g.detail)?.[1] ?? '');

  const totalStreams =
    artist.tracks.reduce((s, t) => s + Math.max(0, ...t.streams.map((x) => x.count), 0), 0);

  if (totalStreams === 0) {
    // No stream data: fraction of catalog affected.
    const affected =
      new Set([...severityByWork.keys()]).size + unregisteredTitles.filter(Boolean).length;
    const total = works.length + unregisteredTitles.filter(Boolean).length;
    return total === 0 ? 0 : Math.round(100 * Math.min(1, affected / total));
  }

  let weighted = 0;
  for (const work of works) {
    const sev = severityByWork.get(work.mlcSongCode);
    if (!sev) continue;
    weighted += streamsOf(work.title) * (sev === 'critical' ? 1 : 0.25);
  }
  for (const title of unregisteredTitles) {
    if (title) weighted += streamsOf(title);
  }
  return Math.round(100 * Math.min(1, weighted / totalStreams));
}
