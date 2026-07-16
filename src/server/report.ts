// Hosted report route rendering — implements report-rendering-instructions.md
// against leak-report-template.html as the EXACT rendering target. Do not
// redesign; permitted deviations from the template: the product name (user
// decision: "Owed", was "Blackbox") and the save bar under the header band
// (download / copy link / email-me actions — user request, Jul 16). All other
// layout/palette/sections are the template's. Data binding follows the
// instructions' binding map; prose comes from writeNarratives (narratives.ts).

import type { ScanJob } from './jobs.js';
import type { Estimate, Gap, LeakReport, MlcWork } from '../types.js';
import { affectedTrackCount, catalogSplit } from '../gap-engine/index.js';
import { monthlyLeak, sumAccrued } from '../estimator/index.js';
import { writeNarratives } from './narratives.js';

const BRAND = 'Owed';
const SCAN_PREFIX = 'OW';

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

const DSP_NAMES: Record<string, string> = {
  spotify: 'Spotify',
  applemusic: 'Apple Music',
  youtube: 'YouTube',
  audiomack: 'Audiomack',
  amazon: 'Amazon Music',
  deezer: 'Deezer',
  tidal: 'Tidal',
  pandora: 'Pandora',
  iheart: 'iHeart',
  soundcloud: 'SoundCloud',
};

function dspList(work: MlcWork): string {
  const distinct = [...new Set(work.matchedRecordings.map((r) => r.dsp))];
  const named = distinct.map((d) => DSP_NAMES[d.toLowerCase()] ?? d);
  return named.slice(0, 4).join(', ') + (named.length > 4 ? ` +${named.length - 4} more` : '');
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function sourcesLine(gaps: Gap[]): string {
  const hosts = new Set(gaps.map((g) => new URL(g.evidence.url).hostname));
  const named: string[] = [];
  if ([...hosts].some((h) => h.includes('themlc'))) named.push('THE MLC (PUBLIC)');
  for (const h of hosts) if (!h.includes('themlc')) named.push(h.toUpperCase());
  return named.join(', ') || 'THE MLC (PUBLIC)';
}

export function renderReport(report: LeakReport): string {
  const { artist, works, gaps, estimates } = report;
  const n = writeNarratives(gaps, estimates, {
    affectedCount: affectedTrackCount(works, gaps, artist),
  });
  const unregGaps = gaps.filter((g) => g.kind === 'work_not_registered');
  const unregTitles = unregGaps
    .map((g) => /^"(.+?)"/.exec(g.detail)?.[1])
    .filter((t): t is string => !!t);
  const split = catalogSplit(works, artist, unregTitles);
  const accrued = sumAccrued(estimates);
  const gapsByWork = new Map<string, Gap[]>();
  for (const g of gaps) {
    if (!g.workRef) continue;
    if (!gapsByWork.has(g.workRef)) gapsByWork.set(g.workRef, []);
    gapsByWork.get(g.workRef)!.push(g);
  }
  const estByWork = new Map(estimates.map((e) => [e.workRef, e]));

  const earliestRelease = artist.tracks
    .map((t) => t.releaseDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  const perMonth = monthlyLeak(estimates, earliestRelease);

  const scanCode = `${SCAN_PREFIX}-${report.generatedAt.slice(0, 10).replace(/-/g, '')}-${report.scanId.slice(0, 4).toUpperCase()}`;
  const kitUrl = report.reportUrl.replace('/r/', '/k/');
  const mailtoHref = `mailto:?subject=${encodeURIComponent(
    `Your ${BRAND} royalty audit — ${artist.resolvedName}`,
  )}&body=${encodeURIComponent(
    `Audit statement: ${report.reportUrl}\nClaim kit: ${kitUrl}\n\nKeep this email — these links are the only way back to your report.`,
  )}`;
  const isrcTrackCount = artist.tracks.filter((t) => t.isrcs.length > 0).length;

  // Card order mirrors the template: leaking works (worst first), then
  // not-registered tracks, then fully-claimed works.
  const leaking = works
    .filter((w) => (gapsByWork.get(w.mlcSongCode) ?? []).some((g) => g.severity === 'critical'))
    .sort(
      (a, b) =>
        (100 - b.totalShares) * b.matchedRecordings.length -
        (100 - a.totalShares) * a.matchedRecordings.length,
    );
  const clean = works.filter((w) => !leaking.includes(w));
  const criticalWorkCount = leaking.length + unregGaps.length;

  const estBox = (e: Estimate | undefined): string =>
    e
      ? `<div class="est"><span class="range">${money(e.accruedUsd.low)} – ${money(e.accruedUsd.high)}</span><span class="cap">estimated held for the unclaimed share · range, not a balance</span></div>`
      : '';

  const workCard = (w: MlcWork): string => {
    const wGaps = gapsByWork.get(w.mlcSongCode) ?? [];
    const critical = wGaps.some((g) => g.severity === 'critical');
    const pct = Math.round(w.totalShares);
    const stampLabel = critical ? `${100 - pct}% UNCLAIMED` : 'FULLY CLAIMED';
    return `
    <div class="card">
      <div class="card-head">
        <div class="title">${esc(titleCasePreserve(w.title))} <small>${w.matchedRecordings.length} recordings earning · ${esc(dspList(w))}</small></div>
        <div class="stamp${critical ? '' : ' ok'}">${esc(stampLabel)}</div>
      </div>
      <div class="minibar">${
        pct > 0 ? `<div class="claimed" style="width:${pct}%"></div>` : ''
      }${pct < 100 ? `<div class="leaking" style="width:${100 - pct}%"></div>` : ''}</div>
      <div class="card-body">
        <div class="who">${n.whoByWork[w.mlcSongCode] ?? 'Registered at 100%. Royalties are flowing correctly. Nothing to do here.'}</div>
        ${estBox(estByWork.get(w.mlcSongCode))}
        <div class="evidence">Verify it yourself: <a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">The MLC public record — song code ${esc(w.mlcSongCode)}</a></div>
      </div>
    </div>`;
  };

  const unregCard = (g: Gap): string => {
    const title = /^"(.+?)"/.exec(g.detail)?.[1] ?? 'Unknown track';
    return `
    <div class="card">
      <div class="card-head">
        <div class="title">${esc(titleCasePreserve(title))} <small>earning on streaming platforms · no US registration found</small></div>
        <div class="stamp">NOT REGISTERED</div>
      </div>
      <div class="minibar"><div class="leaking" style="width:100%"></div></div>
      <div class="card-body">
        <div class="who">${n.whoByUnregistered[title] ?? ''}</div>
        <div class="evidence">Searched: title + all known recording codes — <a href="${esc(g.evidence.url)}" target="_blank" rel="noopener">no matching work found</a></div>
      </div>
    </div>`;
  };

  const appendixEntries = [
    ...works.map((w) => {
      const writers = w.writers
        .map((wr) => `${titleCasePreserve(wr.name)} (IPI <code>${esc(wr.ipi ?? '— missing')}</code>)`)
        .join(', ');
      const pubs =
        w.publishers
          .map((p) => `${titleCasePreserve(p.name)} at ${p.collectionShare}%`)
          .join('; ') || 'none registered';
      const isrcs = [...new Set(w.matchedRecordings.map((r) => r.isrc).filter(Boolean))].slice(0, 3);
      return `<p style="margin-top:8px">${esc(titleCasePreserve(w.title))} — MLC song code <code>${esc(w.mlcSongCode)}</code>${
        w.iswc ? `, ISWC <code>${esc(w.iswc)}</code>` : ''
      }${isrcs.length ? `, ISRC ${isrcs.map((i) => `<code>${esc(i)}</code>`).join(' ')}` : ''}. Writers: ${writers}. Registered collection share: ${Math.round(w.totalShares)}% (${pubs}). Snapshot archived ${esc(fmtDate(w.fetchedAt))}.</p>`;
    }),
    ...unregGaps.map((g) => {
      const title = /^"(.+?)"/.exec(g.detail)?.[1] ?? 'Unknown';
      const isrc = /\(ISRC ([A-Z0-9]+)\)/.exec(g.detail)?.[1];
      return `<p style="margin-top:8px">${esc(titleCasePreserve(title))} — no MLC work found. Searched title${
        isrc ? ` and ISRC <code>${esc(isrc)}</code>` : ''
      }. Snapshot archived ${esc(fmtDate(report.generatedAt))}.</p>`;
    }),
  ].join('\n      ');

  const confidenceBanner =
    artist.disambiguation.confidence !== 'high'
      ? `<div style="background:var(--paper-dim);border-bottom:1px solid var(--line);padding:10px 28px;font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--leak-deep)">Identity matched with ${esc(artist.disambiguation.confidence)} confidence — verify the songs below are yours.</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${BRAND} — Royalty Audit: ${esc(artist.resolvedName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#14110B;          /* dark table the statement sits on */
    --ink-2:#1D1912;
    --paper:#F6F1E5;        /* the statement sheet */
    --paper-dim:#EDE6D4;
    --line:#D8CEB6;
    --text:#241F15;
    --muted:#6E6553;
    --claimed:#3E7C4F;      /* banknote green */
    --leak:#D96C1E;         /* heat — money escaping */
    --leak-deep:#B4530F;
    --stamp:#B4530F;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink);font-family:'Hanken Grotesk',sans-serif;color:var(--text);padding:clamp(12px,3vw,48px)}
  .sheet{max-width:760px;margin:0 auto;background:var(--paper);border-radius:4px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.55)}

  /* Header band */
  .band{background:var(--ink-2);color:var(--paper);padding:20px 28px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .band .brand{font-family:'Fraunces',serif;font-weight:900;font-size:1.05rem;letter-spacing:.02em}
  .band .brand span{color:var(--leak)}
  .band .meta{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:#9C937F;text-align:right;line-height:1.6}

  /* Save bar (approved deviation, Jul 16 — download / copy / email actions) */
  .savebar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--paper-dim);border-bottom:1px solid var(--line);padding:10px 28px}
  .savebar .st{font-family:'JetBrains Mono',monospace;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .saveacts{display:flex;gap:8px;flex-wrap:wrap}
  .sbtn{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text);background:var(--paper);border:1px solid var(--text);border-radius:3px;padding:5px 10px;text-decoration:none;cursor:pointer}
  .sbtn:hover{background:#FBF7EC}
  .sbtn:focus-visible{outline:3px solid var(--leak);outline-offset:2px}

  /* Verdict */
  .verdict{padding:36px 28px 28px;border-bottom:1px solid var(--line)}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
  h1{font-family:'Fraunces',serif;font-weight:700;font-size:clamp(1.5rem,4.6vw,2.2rem);line-height:1.18;letter-spacing:-.01em}
  h1 em{font-style:normal;color:var(--leak-deep);border-bottom:3px solid var(--leak)}
  .verdict p{margin-top:14px;font-size:.95rem;color:var(--muted);max-width:56ch;line-height:1.55}

  /* Catalog split bar — the signature */
  .split{padding:24px 28px;border-bottom:1px solid var(--line)}
  .split-labels{display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:.7rem;margin-bottom:8px}
  .split-labels .l{color:var(--claimed);font-weight:700}
  .split-labels .r{color:var(--leak-deep);font-weight:700}
  .bar{height:34px;border-radius:3px;overflow:hidden;display:flex;border:1px solid var(--ink-2)}
  .bar .claimed{background:var(--claimed);position:relative}
  .bar .leaking{background:repeating-linear-gradient(-45deg,var(--leak),var(--leak) 8px,var(--leak-deep) 8px,var(--leak-deep) 16px)}
  .bar div{display:flex;align-items:center;justify-content:center;color:var(--paper);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.78rem}
  .split .note{margin-top:10px;font-size:.8rem;color:var(--muted)}

  /* Money clock */
  .clock{display:flex;gap:0;border-bottom:1px solid var(--line)}
  .clock>div{flex:1;padding:18px 28px}
  .clock>div+div{border-left:1px solid var(--line)}
  .clock .num{font-family:'Fraunces',serif;font-weight:900;font-size:clamp(1.3rem,3.4vw,1.7rem);color:var(--leak-deep)}
  .clock .num.g{color:var(--claimed)}
  .clock .lbl{font-family:'JetBrains Mono',monospace;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:4px}

  /* Song cards */
  .songs{padding:28px}
  .songs h2{font-family:'Fraunces',serif;font-size:1.05rem;font-weight:700;margin-bottom:16px}
  .card{border:1px solid var(--line);border-radius:4px;background:#FBF7EC;margin-bottom:14px;overflow:hidden}
  .card-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;gap:10px;flex-wrap:wrap}
  .card-head .title{font-weight:700;font-size:1rem}
  .card-head .title small{display:block;font-weight:500;color:var(--muted);font-size:.75rem;margin-top:2px}
  .stamp{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.66rem;letter-spacing:.12em;color:var(--stamp);border:2px solid var(--stamp);border-radius:3px;padding:4px 8px;transform:rotate(-2deg)}
  .stamp.ok{color:var(--claimed);border-color:var(--claimed)}
  .minibar{height:10px;display:flex;margin:0 16px;border-radius:2px;overflow:hidden;border:1px solid var(--line)}
  .minibar .claimed{background:var(--claimed)}
  .minibar .leaking{background:repeating-linear-gradient(-45deg,var(--leak),var(--leak) 5px,var(--leak-deep) 5px,var(--leak-deep) 10px)}
  .card-body{padding:12px 16px 16px;font-size:.88rem;line-height:1.55}
  .card-body .who{margin-bottom:8px}
  .card-body .who b{color:var(--leak-deep)}
  .est{display:flex;justify-content:space-between;align-items:baseline;background:var(--paper-dim);border:1px dashed var(--line);border-radius:3px;padding:10px 12px;margin-top:10px;gap:8px;flex-wrap:wrap}
  .est .range{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1rem;color:var(--leak-deep)}
  .est .cap{font-size:.72rem;color:var(--muted)}
  .evidence{margin-top:10px;font-size:.75rem}
  .evidence a{color:var(--claimed);font-weight:600;text-decoration:none;border-bottom:1px solid var(--claimed)}

  /* CTA */
  .cta{margin:0 28px 28px;background:var(--ink-2);border-radius:4px;color:var(--paper);padding:22px;display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
  .cta .t{font-family:'Fraunces',serif;font-weight:700;font-size:1.05rem;max-width:34ch;line-height:1.3}
  .cta .t small{display:block;font-family:'Hanken Grotesk';font-weight:400;font-size:.78rem;color:#9C937F;margin-top:6px}
  .btn{background:var(--leak);color:#fff;font-weight:700;font-size:.9rem;padding:12px 20px;border-radius:3px;text-decoration:none;white-space:nowrap}

  /* Method + appendix */
  .foot{padding:20px 28px 28px;border-top:1px solid var(--line);font-size:.75rem;color:var(--muted);line-height:1.6}
  .foot details{margin-top:10px}
  .foot summary{cursor:pointer;font-weight:600;color:var(--text)}
  .foot code{font-family:'JetBrains Mono',monospace;font-size:.7rem;background:var(--paper-dim);padding:1px 5px;border-radius:2px}
  @media (max-width:520px){.clock{flex-direction:column}.clock>div+div{border-left:none;border-top:1px solid var(--line)}}
</style>
</head>
<body>
<div class="sheet">

  <div class="band">
    <div class="brand">OW<span>ED</span> · ROYALTY AUDIT</div>
    <div class="meta">SCAN ${esc(scanCode)}<br>GENERATED ${esc(fmtDate(report.generatedAt))} · SOURCES: ${esc(sourcesLine(gaps))}</div>
  </div>
  <div class="savebar">
    <span class="st">Save this report — it lives only at this link</span>
    <span class="saveacts">
      <a class="sbtn" href="?download=1">Download</a>
      <button class="sbtn" id="copy-link" type="button">Copy link</button>
      <a class="sbtn" href="${esc(mailtoHref)}">Email me the link</a>
    </span>
  </div>
  ${confidenceBanner}
  <div class="verdict">
    <div class="eyebrow">Artist · ${esc(artist.resolvedName)} — catalog verified by ISRC (${isrcTrackCount} tracks)</div>
    <h1>${n.verdictH1.pre}<em>${esc(n.verdictH1.em)}</em>${n.verdictH1.post}</h1>
    <p>${n.verdictParagraph}</p>
  </div>

  <div class="split">
    <div class="split-labels"><span class="l">BEING PAID OUT</span><span class="r">HELD / UNCLAIMED</span></div>
    <div class="bar">
      ${split.claimedPct > 0 ? `<div class="claimed" style="width:${split.claimedPct}%">${split.claimedPct}%</div>` : ''}
      ${split.unclaimedPct > 0 ? `<div class="leaking" style="width:${split.unclaimedPct}%">${split.unclaimedPct}%</div>` : ''}
    </div>
    <div class="note">Share of your catalog's registered US songwriter royalties, weighted by streaming volume.</div>
  </div>

  <div class="clock">
    <div><div class="num">${accrued ? `${money(accrued.low)} – ${money(accrued.high)}` : '—'}</div><div class="lbl">Est. accrued to date</div></div>
    <div><div class="num">${perMonth !== null ? `≈ ${money(perMonth)} / mo` : '—'}</div><div class="lbl">Est. ongoing leak</div></div>
    <div><div class="num g">$0</div><div class="lbl">Cost to claim (MLC is free)</div></div>
  </div>

  <div class="songs">
    <h2>Song-by-song findings</h2>
${leaking.map(workCard).join('\n')}
${unregGaps.map(unregCard).join('\n')}
${clean.map(workCard).join('\n')}
  </div>

  ${
    criticalWorkCount > 0
      ? `<div class="cta">
    <div class="t">Fix all ${criticalWorkCount} gaps with a guided claim kit built for this exact catalog.
      <small>Registration itself is free — the kit is the map: member setup, W-8BEN for non-US writers, every song and share to claim, done in an evening.</small>
    </div>
    <a class="btn" href="${esc(kitUrl)}">Get the claim kit · $5</a>
  </div>`
      : ''
  }

  <div class="foot">
    <strong>How the estimates work:</strong> public stream counts × estimated US share of streams (25–40%) × the US statutory songwriter rate × your unclaimed percentage. Ranges, not balances — only claiming reveals the exact figure held. The registration gaps themselves are not estimates: each one links to the public record above.
    <details><summary>Registry data appendix (for your publisher or lawyer)</summary>
      ${appendixEntries}
    </details>
    <p style="margin-top:12px">${BRAND} is not affiliated with The MLC. Claiming through The MLC is free. This report is educational guidance, not legal advice.</p>
  </div>

</div>
<script>
  (function () {
    var b = document.getElementById('copy-link');
    if (!b) return;
    if (!navigator.clipboard) { b.style.display = 'none'; return; }
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(${JSON.stringify(report.reportUrl)}).then(function () {
        b.textContent = 'Copied ✓';
        setTimeout(function () { b.textContent = 'Copy link'; }, 1600);
      });
    });
  })();
</script>
</body>
</html>`;
}

/** UPPERCASE registry strings → Title Case for display; leaves mixed case alone. */
function titleCasePreserve(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Adapter for the server: build a LeakReport from a completed job. */
export function renderReportHtml(job: ScanJob, baseUrl: string): string {
  if (job.status !== 'complete' || !job.result || job.result.status !== 'complete') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${BRAND} — scan ${esc(job.status)}</title></head>
<body style="font-family:system-ui;background:#14110B;color:#F6F1E5;display:grid;place-items:center;min-height:100dvh">
<div><h1>Scan ${esc(job.status)}</h1><p>Report appears here when the scan completes. Poll scan_status with your scanId.</p></div></body></html>`;
  }
  const r = job.result;
  const report: LeakReport = {
    scanId: job.scanId,
    artist: r.artist,
    works: r.works,
    gaps: r.gaps,
    estimates: r.estimates ?? [], // present when YOUTUBE_API_KEY was set at scan time
    leakScore: r.leakScore,
    generatedAt: r.generatedAt,
    reportUrl: `${baseUrl}/r/${job.scanId}`,
  };
  return renderReport(report);
}
