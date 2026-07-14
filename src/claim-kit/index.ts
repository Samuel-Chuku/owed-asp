// Claim kit generator — §5 step 7, the paid conversion. Pure function from a
// completed scan: turns the gap findings into a personalized, ordered fix
// plan. Deterministic template; educational guidance, not legal advice.

import type { ScanResult } from '../pipeline/scan.js';

export type KitStep = {
  title: string;
  why: string;
  actions: string[];
  links: { label: string; url: string }[];
};

export type ClaimKit = {
  artist: string;
  generatedAt: string;
  intro: string;
  steps: KitStep[];
  checklist: string[];
  timeline: string;
  disclaimer: string;
};

export function generateClaimKit(result: Extract<ScanResult, { status: 'complete' }>): ClaimKit {
  const artist = result.artist.resolvedName;
  const partialWorks = result.works.filter((w) => w.totalShares < 100);
  const unregGaps = result.gaps.filter((g) => g.kind === 'work_not_registered');
  const noIpiWriters = [
    ...new Set(
      result.gaps
        .filter((g) => g.kind === 'missing_writer_ipi')
        .map((g) => /Writer (.+?) on/.exec(g.detail)?.[1])
        .filter((n): n is string => !!n),
    ),
  ];

  const steps: KitStep[] = [];

  steps.push({
    title: 'Join The MLC (free)',
    why: 'Only MLC members can claim shares and collect the US mechanical royalties this report found accruing. Membership costs nothing.',
    actions: [
      `Register as a Self-Administered Songwriter (you write and own your shares) — or as a publisher member if ${artist} has a publishing entity.`,
      'Use the legal name that matches your identity documents; add your stage name as an alias.',
      'Non-US claimants: no SSN is required. During onboarding, complete the W-8BEN tax form (individuals) — check the current MLC help page for treaty-benefit specifics for your country.',
    ],
    links: [
      { label: 'The MLC — Become a Member', url: 'https://www.themlc.com/join' },
      { label: 'The MLC — Support / tax guidance', url: 'https://support.themlc.com' },
    ],
  });

  if (partialWorks.length) {
    steps.push({
      title: `Claim your unregistered shares on ${partialWorks.length} registered work${partialWorks.length === 1 ? '' : 's'}`,
      why: 'These works are already earning (matched recordings exist) but part of the ownership is unclaimed — that money accrues instead of being paid.',
      actions: partialWorks.map(
        (w) =>
          `“${w.title}” (song code ${w.mlcSongCode}): ${w.totalShares}% registered today — use the MLC Claiming Tool to review the work and claim your writer share. Evidence: ${w.sourceUrl}`,
      ),
      links: [{ label: 'MLC Portal — log in and open the Claiming Tool', url: 'https://portal.themlc.com' }],
    });
  }

  if (unregGaps.length) {
    steps.push({
      title: `Register ${unregGaps.length} work${unregGaps.length === 1 ? '' : 's'} that are missing entirely`,
      why: '100% of the US mechanicals on these tracks accrue as unclaimed until the works exist in the database.',
      actions: unregGaps.map((g) => {
        const title = /^"(.+?)"/.exec(g.detail)?.[1] ?? 'Unknown';
        const isrc = /\(ISRC ([A-Z0-9]+)\)/.exec(g.detail)?.[1] ?? '—';
        return `Register “${title}” (link recording ISRC ${isrc}) with your writer split and role.`;
      }),
      links: [{ label: 'MLC Portal — register new works', url: 'https://portal.themlc.com' }],
    });
  }

  if (noIpiWriters.length) {
    steps.push({
      title: `Get IPI numbers for: ${noIpiWriters.join(', ')}`,
      why: 'An IPI (Interested Party Information) number is your global songwriter ID. Without it, societies cannot reliably match your royalties across borders.',
      actions: [
        'Join a performing rights organization (PRO) — it assigns your IPI on membership.',
        'Common choices: ASCAP or BMI (US), PRS (UK), or your national society. Pick ONE as a writer.',
        'After the IPI arrives, update your MLC member profile and work registrations with it.',
      ],
      links: [
        { label: 'ASCAP — join as a writer', url: 'https://www.ascap.com/join' },
        { label: 'BMI — join as a writer', url: 'https://www.bmi.com/join' },
      ],
    });
  }

  steps.push({
    title: 'Parallel: performance royalties (separate pot)',
    why: 'The MLC only handles US mechanicals. Performance royalties for the same songs flow through your PRO — joining one (previous step) starts that collection too.',
    actions: [
      'Register the same works with your PRO after joining.',
      'If your recordings get US radio/satellite/webcast play, also register with SoundExchange (free) for digital performance royalties on the recording side.',
    ],
    links: [{ label: 'SoundExchange — register', url: 'https://www.soundexchange.com' }],
  });

  const checklist = [
    'MLC membership created (free)',
    ...(partialWorks.length ? [`Shares claimed on: ${partialWorks.map((w) => w.title).join(', ')}`] : []),
    ...(unregGaps.length
      ? [`New works registered: ${unregGaps.map((g) => /^"(.+?)"/.exec(g.detail)?.[1]).filter(Boolean).join(', ')}`]
      : []),
    ...(noIpiWriters.length ? [`IPI numbers obtained for: ${noIpiWriters.join(', ')}`] : []),
    'PRO membership + work registrations done',
    'W-8BEN completed (non-US)',
    'Calendar reminder set: check MLC match activity in 60–90 days',
  ];

  return {
    artist,
    generatedAt: new Date().toISOString(),
    intro: `This kit turns ${artist}'s leak report into an ordered fix plan. Do the steps top to bottom — the first two unlock the money that is already accruing; the rest stop future leaks. Everything here is free to do yourself; Owed charges for finding the gaps and assembling this plan, never for “registration.”`,
    steps,
    checklist,
    timeline:
      'Typical timeline: MLC membership approval takes days; claims and new registrations process in weeks. US mechanicals distribute monthly, so expect first corrected payments 1–3 distribution cycles after your claims process. Historical unmatched royalties, where available, arrive after your claims are matched — only the MLC can state the exact held amount.',
    disclaimer:
      'Educational guidance based on publicly verifiable registry data — not legal or tax advice. Verify current MLC/PRO requirements on their official pages. Owed is not affiliated with The MLC.',
  };
}
