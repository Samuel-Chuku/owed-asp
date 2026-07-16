/* Hallmark · macrostructure: Long Document (statement pages) · tone: editorial audit
 * theme: studied-DNA (source: leak-report-template.html) · paper #F6F1E5 · ink #14110B
 * accents: banknote green / heat orange · fonts: Fraunces + Hanken Grotesk + JetBrains Mono
 * studied: yes — this page must share the report sheet's DNA, not diverge from it. */

// Hosted claim-kit page (/k/{scanId}) — redesigned to match the report
// template's "royalty audit statement" language (user direction, Jul 11):
// same paper sheet on the dark table, bigger type for readability, and
// interactive: collapsible steps, checkboxes that persist in localStorage,
// and a live progress line. Content is unchanged — pure generator output.

import type { ClaimKit } from '../claim-kit/index.js';

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderKitHtml(kit: ClaimKit, scanId = '', baseUrl = ''): string {
  const kitUrl = baseUrl && scanId ? `${baseUrl}/k/${scanId}` : '';
  const reportUrl = baseUrl && scanId ? `${baseUrl}/r/${scanId}` : '';
  const mailtoHref = kitUrl
    ? `mailto:?subject=${encodeURIComponent(`Your Owed claim kit — ${kit.artist}`)}&body=${encodeURIComponent(
        `Claim kit: ${kitUrl}\nAudit statement: ${reportUrl}\n\nKeep this email — these links are the only way back to your report.`,
      )}`
    : '';
  const savebar = kitUrl
    ? `
  <div class="savebar">
    <span class="st">Save this kit — it lives only at this link</span>
    <span class="saveacts">
      <a class="sbtn" href="?download=1">Download</a>
      <button class="sbtn" id="copy-link" type="button">Copy link</button>
      <a class="sbtn" href="${esc(mailtoHref)}">Email me the link</a>
    </span>
  </div>`
    : '';
  const steps = kit.steps
    .map(
      (s, i) => `
    <details class="step"${i === 0 ? ' open' : ''}>
      <summary>
        <span class="num">${i + 1}</span>
        <span class="stitle">${esc(s.title)}</span>
        <span class="chev">›</span>
      </summary>
      <div class="body">
        <p class="why">${esc(s.why)}</p>
        <ul>${s.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        <div class="links">${s.links
          .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`)
          .join('')}</div>
      </div>
    </details>`,
    )
    .join('\n');

  const checklist = kit.checklist
    .map(
      (c, i) => `
      <label class="tick"><input type="checkbox" data-idx="${i}"><span class="box" aria-hidden="true"></span><span class="txt">${esc(c)}</span></label>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Owed — Claim Kit: ${esc(kit.artist)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#14110B; --ink-2:#1D1912;
    --paper:#F6F1E5; --paper-dim:#EDE6D4; --line:#D8CEB6;
    --text:#241F15; --muted:#6E6553;
    --claimed:#3E7C4F; --leak:#D96C1E; --leak-deep:#B4530F;
    --font-display:'Fraunces',serif; --font-body:'Hanken Grotesk',sans-serif; --font-mono:'JetBrains Mono',monospace;
    --ease-out:cubic-bezier(.16,1,.3,1);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{overflow-x:clip}
  body{background:var(--ink);font-family:var(--font-body);color:var(--text);padding:clamp(12px,3vw,48px);font-size:17px;line-height:1.6}
  .sheet{max-width:760px;margin:0 auto;background:var(--paper);border-radius:4px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.55)}

  .band{background:var(--ink-2);color:var(--paper);padding:20px 28px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .band .brand{font-family:var(--font-display);font-weight:900;font-size:1.05rem;letter-spacing:.02em}
  .band .brand span{color:var(--leak)}
  .band .meta{font-family:var(--font-mono);font-size:.68rem;color:#9C937F;text-align:right;line-height:1.6}

  /* Save bar (matches the report page's, user request Jul 16) */
  .savebar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--paper-dim);border-bottom:1px solid var(--line);padding:10px 28px}
  .savebar .st{font-family:var(--font-mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .saveacts{display:flex;gap:8px;flex-wrap:wrap}
  .sbtn{font-family:var(--font-mono);font-weight:700;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text);background:var(--paper);border:1px solid var(--text);border-radius:3px;padding:5px 10px;text-decoration:none;cursor:pointer}
  .sbtn:hover{background:#FBF7EC}
  .sbtn:focus-visible{outline:3px solid var(--leak);outline-offset:2px}

  .head{padding:36px 28px 24px;border-bottom:1px solid var(--line)}
  .eyebrow{font-family:var(--font-mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
  h1{font-family:var(--font-display);font-weight:700;font-size:clamp(1.7rem,5vw,2.4rem);line-height:1.15;letter-spacing:-.01em;overflow-wrap:anywhere;min-width:0}
  .head p{margin-top:16px;font-size:1.02rem;color:var(--muted);max-width:58ch;line-height:1.6}

  .progress{display:flex;align-items:center;gap:14px;padding:18px 28px;border-bottom:1px solid var(--line);background:var(--paper-dim)}
  .progress .count{font-family:var(--font-display);font-weight:900;font-size:1.5rem;color:var(--claimed);min-width:3.2ch}
  .progress .plabel{font-family:var(--font-mono);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .pbar{flex:1;height:10px;border:1px solid var(--ink-2);border-radius:2px;overflow:hidden;background:var(--paper)}
  .pbar .fill{height:100%;width:0%;background:var(--claimed);transition:width .35s var(--ease-out)}

  .steps{padding:28px}
  .steps h2{font-family:var(--font-display);font-size:1.15rem;font-weight:700;margin-bottom:16px}
  .step{border:1px solid var(--line);border-radius:4px;background:#FBF7EC;margin-bottom:14px;overflow:hidden}
  .step summary{display:flex;align-items:center;gap:14px;padding:16px;cursor:pointer;list-style:none}
  .step summary::-webkit-details-marker{display:none}
  .step summary:hover{background:var(--paper-dim)}
  .step summary:focus-visible{outline:3px solid var(--leak);outline-offset:-3px}
  .num{font-family:var(--font-mono);font-weight:700;font-size:.8rem;color:var(--leak-deep);border:2px solid var(--leak-deep);border-radius:3px;min-width:30px;height:30px;display:grid;place-items:center;transform:rotate(-2deg);flex-shrink:0}
  .stitle{font-weight:700;font-size:1.08rem;flex:1;line-height:1.3}
  .chev{color:var(--muted);font-size:1.2rem;transition:transform .2s var(--ease-out)}
  .step[open] .chev{transform:rotate(90deg)}
  .body{padding:2px 16px 18px 60px}
  .why{color:var(--muted);font-size:.98rem;margin-bottom:12px;max-width:56ch}
  .body ul{list-style:none;display:grid;gap:10px}
  .body li{font-size:.98rem;padding-left:14px;border-left:3px solid var(--line);overflow-wrap:anywhere}
  .links{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px}
  .links a{color:var(--claimed);font-weight:600;font-size:.92rem;text-decoration:none;border-bottom:1px solid var(--claimed)}
  .links a:focus-visible{outline:3px solid var(--leak);outline-offset:2px}

  .checks{margin:0 28px 28px;border:1px solid var(--line);border-radius:4px;background:#FBF7EC}
  .checks h2{font-family:var(--font-display);font-size:1.15rem;font-weight:700;padding:16px 16px 4px}
  .checks .hint{font-family:var(--font-mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0 16px 10px}
  .tick{display:flex;gap:14px;align-items:flex-start;padding:13px 16px;border-top:1px solid var(--line);cursor:pointer;font-size:1rem;line-height:1.45}
  .tick:hover{background:var(--paper-dim)}
  .tick input{position:absolute;opacity:0;width:1px;height:1px}
  .tick .box{width:22px;height:22px;border:2px solid var(--ink-2);border-radius:3px;flex-shrink:0;display:grid;place-items:center;margin-top:1px;background:var(--paper);transition:background .15s var(--ease-out)}
  .tick .box::after{content:'✓';font-family:var(--font-mono);font-weight:700;font-size:.85rem;color:var(--paper);opacity:0;transform:scale(.6);transition:opacity .15s var(--ease-out),transform .15s var(--ease-out)}
  .tick input:checked + .box{background:var(--claimed);border-color:var(--claimed)}
  .tick input:checked + .box::after{opacity:1;transform:scale(1)}
  .tick input:checked ~ .txt{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--claimed);text-decoration-thickness:2px}
  .tick input:focus-visible + .box{outline:3px solid var(--leak);outline-offset:2px}

  .timeline{margin:0 28px 28px;padding:16px 18px;border:1px dashed var(--line);border-radius:3px;background:var(--paper-dim);font-size:.95rem;color:var(--muted);line-height:1.65}
  .timeline b{color:var(--text);font-family:var(--font-mono);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;display:block;margin-bottom:6px}

  .foot{padding:20px 28px 28px;border-top:1px solid var(--line);font-size:.82rem;color:var(--muted);line-height:1.6}

  @media (prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}}
  @media (max-width:520px){.body{padding-left:16px}}
</style>
</head>
<body>
<div class="sheet">

  <div class="band">
    <div class="brand">OW<span>ED</span> · CLAIM KIT</div>
    <div class="meta">COMPANION TO THE ROYALTY AUDIT<br>GENERATED ${esc(new Date(kit.generatedAt).toUTCString().slice(5, 16).toUpperCase())}</div>
  </div>
${savebar}

  <div class="head">
    <div class="eyebrow">Artist · ${esc(kit.artist)} — ordered fix plan</div>
    <h1>Every gap in the audit, turned into a to-do you can finish in an evening.</h1>
    <p>${esc(kit.intro)}</p>
  </div>

  <div class="progress">
    <span class="count" id="done">0/${kit.checklist.length}</span>
    <div class="pbar"><div class="fill" id="fill"></div></div>
    <span class="plabel">Claimed back</span>
  </div>

  <div class="steps">
    <h2>The steps, in order</h2>
${steps}
  </div>

  <div class="checks">
    <h2>Tick as you go</h2>
    <div class="hint">Saved on this device — come back anytime</div>
${checklist}
  </div>

  <div class="timeline"><b>What to expect</b>${esc(kit.timeline)}</div>

  <div class="foot"><p>${esc(kit.disclaimer)}</p></div>

</div>
<script>
  (function () {
    var key = 'owed-kit-${esc(scanId)}';
    var boxes = Array.prototype.slice.call(document.querySelectorAll('.tick input'));
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    boxes.forEach(function (b) { if (saved.indexOf(Number(b.dataset.idx)) !== -1) b.checked = true; });
    function paint() {
      var done = boxes.filter(function (b) { return b.checked; }).length;
      document.getElementById('done').textContent = done + '/' + boxes.length;
      document.getElementById('fill').style.width = (boxes.length ? (100 * done / boxes.length) : 0) + '%';
    }
    boxes.forEach(function (b) {
      b.addEventListener('change', function () {
        var ticked = boxes.filter(function (x) { return x.checked; }).map(function (x) { return Number(x.dataset.idx); });
        try { localStorage.setItem(key, JSON.stringify(ticked)); } catch (e) {}
        paint();
      });
    });
    paint();
  })();
  (function () {
    var b = document.getElementById('copy-link');
    if (!b) return;
    if (!navigator.clipboard) { b.style.display = 'none'; return; }
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(${JSON.stringify(kitUrl)} || location.href.split('?')[0]).then(function () {
        b.textContent = 'Copied ✓';
        setTimeout(function () { b.textContent = 'Copy link'; }, 1600);
      });
    });
  })();
</script>
</body>
</html>`;
}
