# Report Rendering — Instructions for Claude Code

You are implementing the hosted report route (`GET /r/:scanId`) for the Blackbox ASP.
`leak-report-template.html` is the **exact rendering target**. Do not redesign it. Do not
add sections, change the palette, or "improve" the layout. Your job is to turn it into a
server-rendered template bound to the `LeakReport` type from the build spec.

## Deliverables
1. A render function `renderReport(report: LeakReport): string` (server-side, no client JS
   framework — this stays a static HTML response served by Fastify).
2. The narrative-writer module `writeNarratives(gaps, estimates)` that produces the
   plain-language strings (rules below).
3. A test that renders `fixtures/speedometer-scan.json` and snapshots the output.

## Data binding map (template → schema)

| Template element | Source |
|---|---|
| Header `SCAN BX-...` / date / sources | `scanId`, `generatedAt`, distinct `gaps[].evidence` sources |
| Eyebrow "Artist · X — catalog verified by ISRC (N tracks)" | `artist.resolvedName`, count of ISRC-verified tracks |
| H1 verdict sentence | narrative writer, from `gaps` summary (see rules) |
| Verdict paragraph | static copy + narrative writer variant |
| Catalog split bar % | derived: stream-weighted claimed vs unclaimed share across works (pure function, put in gap engine, not in the template code) |
| Money clock: accrued range | sum of `estimates[].accruedUsd` low/high |
| Money clock: monthly leak | sum of estimates ÷ months since earliest affected release (pure function) |
| Money clock: "$0 cost to claim" | static — never remove; it is the trust line |
| Song card title/small | `works[].title`, `matchedRecordings.length`, distinct DSPs |
| Stamp | severity mapping: any critical gap on work → orange stamp with gap label (`50% UNCLAIMED` from `100 - totalShares`, or `NOT REGISTERED` for `work_not_registered`); no gaps → green `FULLY CLAIMED` |
| Mini split bar widths | `totalShares` / `100 - totalShares` |
| "who" line | narrative writer, from the work's `gaps[].detail` |
| Estimate box | `estimates[]` for that work; **omit the box entirely if no estimate** — never render a placeholder number |
| Evidence link | `gaps[].evidence.url`, label includes `mlcSongCode` |
| CTA gap count | count of works with ≥1 critical gap |
| Appendix | raw work fields: song code, ISWC, ISRCs, writers + IPIs, publishers + shares, snapshot date |
| Disclaimers in footer | static — never remove or reword |

## Narrative writer rules (hard constraints, put in the system prompt verbatim)
- Input is ONLY the `gaps` and `estimates` JSON. Never introduce a fact not present in it.
- Write for a musician with zero industry knowledge. The words IPI, ISWC, ISRC, and
  "mechanical" may not appear outside the appendix; say "songwriter royalties" and
  "the US registry".
- Every "who" line answers, in order: what's wrong → whose money → what happens to it.
- Never state a dollar figure in prose; money appears only in the estimate box as a range.
- Never write "you are owed" — write "held", "unclaimed", "not reaching anyone".
- Verdict sentence pattern: "Money is being collected on {N} of your songs that isn't
  reaching anyone." If N=0: "Your catalog is fully registered. Royalties are flowing
  correctly." (render the report anyway — a clean bill is also shareable).

## Rendering rules
- Escape all scraped strings (writer names, titles) — they are untrusted input.
- Numbers: money always `$X,XXX – $X,XXX` en dash, mono font; percentages integers.
- If `artist.disambiguation.confidence !== 'high'`, render a banner above the verdict:
  "Identity matched with medium confidence — verify the songs below are yours."
- Report page must render correctly at 380px wide (screenshots come from phones).
- No client-side JS except the `<details>` appendix (native). No analytics in v1.

## What to also pass alongside this file
- `leak-report-template.html` (the target)
- `fixtures/speedometer-scan.json` — a REAL scan output from your pipeline, saved as-is.
  If the pipeline's shape differs from the `LeakReport` type, fix the pipeline, not the
  template.
