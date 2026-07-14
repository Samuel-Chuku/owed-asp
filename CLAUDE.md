# Owed — Royalty Leak Scanner ASP (OKX.AI Genesis Hackathon, deadline Jul 17 2026)

**Name decision (user, Jul 11): the product is "Owed"** (was working-name Blackbox). Brand constant lives in `src/server/report.ts`; also set in package.json, MCP serverInfo, payment descriptions.

Full build spec: `royalty-asp-build-spec.md`. This file records the non-negotiables and what the Day-1 spike discovered.

## Non-negotiables (verbatim from spec §3)
1. **Never let the LLM compute money or verdicts.** Gap detection and estimation are pure functions.
2. **No leak claim without ISRC-verified identity.** Every flagged work must have ≥1 matched-recording ISRC present in the artist's canonical catalog (the Rema lesson).
3. **Every flag carries provenance:** the source URL + a stored page snapshot. Reports must be independently verifiable.
4. **Estimates are always ranges with the method printed.** Never a single number, never implied certainty about held balances.
5. **Payment success is determined server-side** via the OKX Payment SDK callback/verification — never by the client claiming it paid.
6. **Respectful scraping:** ≥3s between MLC calls, 7-day work cache, 24h scan cache, exponential backoff, "not affiliated with The MLC" disclaimer on every report.

## Key discovery (Day 1): the MLC needs no browser
`portal.themlc.com` is an SPA over an **open JSON API** — plain HTTP with browser-like headers works. Playwright/stealth is a fallback only. Endpoints (captured from real traffic):

- `POST https://api.ptl.themlc.com/api2v/public/search/works?page={n}&size={n}` body `{"combinedTitles":"<title>"}` → works with `writers[]` (ipiNumber nullable), `originalPublishers[]` (admin chains + shares + represented `writers[]`), `totalKnownShares` (THE number), `iswc`, `matchedRecordings` (first 10 + count).
- `GET https://api.ptl.themlc.com/api/dsp-recording/matched/{songCode}?page={n}&limit=50&order=matchedAmount&direction=desc` → paginated matched recordings incl. ISRC, DSP, label, distributor, and matched/unmatched royalty amounts.
- `GET .../api2v/public/search/works/suggestions?property=combinedTitles&searchTerm=...` → autocomplete.
- Writer-tab search body shape: **unknown** — capture from the UI Writer tab in a later spike.
- Work page URL for provenance: `https://portal.themlc.com/catalog/work/{id}`.

Identity/catalog sources: MusicBrainz (identity, aliases; flaky TLS — retries built in; thin Afrobeats coverage) + **Deezer keyless API** (primary ISRC catalog: `/search/artist`, `/artist/{id}/albums` (release_date per album → track releaseDate), `/album/{id}/tracks` — tracklists include `isrc`). Spotify enrichment optional behind `SPOTIFY_CLIENT_ID/SECRET`. Node needs `setDefaultResultOrder('ipv4first')` (no IPv6 here).

Estimator wired (Jul 14): `src/streams/youtube.ts` (search.list 100 units + videos.list 1 unit per track, 7-day disk cache) feeds `runScan` when `YOUTUBE_API_KEY` is set (.env, gitignored — key present locally). Estimates flow: pipeline → job → report money clock + per-card est boxes. Quick check deliberately skips streams (quota + latency). `.env` is loaded via `process.loadEnvFile` in server + scan CLI.

## Layout
- `src/types.ts` — Zod schemas (source of truth for all tool I/O)
- `src/crawlers/mlc.ts` — MLC API client (rate-limited, cached, snapshots to `data/`)
- `src/gap-engine/` , `src/estimator/` — pure functions, fixture-tested
- `src/identity/` — MusicBrainz + Deezer resolver
- `fixtures/works/` — frozen real works: `speedometer-shallipopi` (50% shares, 76 recordings), `muchuzi-rema` (30%)
- `scripts/` — spikes + `e2e-shallipopi.ts` live pipeline check + `scan.ts` (full scan CLI: `npx tsx scripts/scan.ts "<artist>" [--max-tracks N]`)
- `src/pipeline/scan.ts` — runScan(): the §5 pipeline as one function (CLI + server share it)
- `src/server/` — MCP server (`npm run server`, port 8402): Fastify + streamable HTTP stateless; tools royalty_quick_check/$1, royalty_leak_scan/$5 (async→scanId), claim_kit_generate/$19, scan_status/free; routes /r/{scanId} (report, Notes.fm-style status matrix), /k/{scanId} (claim kit), /evidence/{file} (captured registry snapshots); `jobs.ts` file-backed job store (data/jobs/); `payment.ts` x402 gate (PAYMENT_MODE=off|x402; challenge works, facilitator settlement verification still TODO — refuses paid calls in x402 mode rather than trusting the header)
- `src/claim-kit/` — pure generator: gaps → ordered fix plan (MLC membership, claims, registrations, IPI/PRO, W-8BEN, checklist, timeline)

Known refinement needed: `writer_no_publisher` fires on works with 100% registered shares (e.g. BENIN BOYS) — possibly an MLC data-linkage artifact rather than a real leak; consider downgrading severity when `totalShares === 100`.

`npm test` (vitest, offline, fixture-based) and `npm run typecheck` must pass before finishing any task.

## Pricing decision (user, Jul 10 — overrides spec §6)
`royalty_quick_check` is **$1**, not free (business-potential signal for judges). To justify the price its output is richer than the spec's yes/no: leak-score preview + count of gaps by kind, still no per-work details. `scan_status` stays free. Full pipeline: `royalty_leak_scan` $5, `claim_kit_generate` $19, `royalty_estimate` included.

## Report template (user-supplied, Jul 11 — follow strictly)
`leak-report-template.html` + `report-rendering-instructions.md` are the rendering contract for /r/{scanId} (src/server/report.ts renderReport + narratives.ts writeNarratives; snapshot-tested against fixtures/speedometer-scan.json). Approved deviations (user, Jul 11): (1) empty money-clock cells render an em-dash, never numbers; (2) verdict counts distinct affected TRACKS (gap-engine affectedTrackCount), not works+unregistered; (3) split bar includes unregistered tracks at 0% claimed, weighted at catalog-average when stream data is absent. Only other permitted change: the brand name.

## Frontend (built Jul 14, user reordered it earlier than Day 6)
`frontend/` — hand-rolled Next.js 15 app (no create-next-app), fully static build, deploys to Vercel. Single page sharing the report template's audit-statement DNA (tokens mirrored in `app/globals.css`; fonts via next/font). Calls `GET /api/quick-check?artist=` on the Fastify server (free site hook per the Jul 10 decision; CORS `*`, 20s/IP throttle). Env: `NEXT_PUBLIC_API_BASE` (backend origin), `NEXT_PUBLIC_LISTING_URL` (paid buttons; renders "listing in review" placeholder until set). The /k claim-kit page was redesigned to the same DNA (bigger type, localStorage checklist + progress bar; scanId passed to renderKitHtml for the storage key).

## Frontend decision (user, Jul 10 — build LAST, after everything else ships)
One Next.js page on Vercel, Day-6 work only: hero → artist-name input → free quick-check result → teaser of the full report; paid buttons route to the OKX.AI listing during the hackathon window (no Paystack in week one). It calls the same backend as the MCP tools. Purpose: Social Buzz + post-hackathon distribution (Lagos producers don't live on OKX.AI) — it adds nothing to ASP listing review. If Day 6 arrives behind schedule, the hosted report page alone carries the demo. "Frontend is dessert, not dinner." The user also wants this as their own friendly interface to the agent's abilities.

## Domain (user, Jul 14): useowed.xyz — Cloudflare nameservers, DNS record must be DNS-only (grey cloud) so Caddy issues TLS. Endpoint for the listing: https://useowed.xyz/mcp. Deploy MUST precede ASP registration (listing rejects non-live endpoints; URL is permanent on-chain). ASP avatar: assets/owed-avatar.png. Wallet/agent CLI commands are classifier-blocked for the agent — user runs them with agent-prepared values.

## Still to build (spec §5–7)
DURP/Radar lookups (both reachable via plain HTTP; APIs not yet captured) · YouTube stream counts · report writer + hosted report page · claim kit generator · MCP server assembly (mcp-builder conventions) + OKX Payment SDK gating · deploy (VPS, Caddy, PM2) · OKX.AI listing (submit by Day 4 = Jul 13).

**Blocked on user:** install the OKX skills (the spec's `okx-ai-guide` no longer exists — it merged into `okx-ai` in v4.2.2); run in an interactive session:
```bash
npx skills add https://github.com/okx/onchainos-skills --skill okx-ai
npx skills add https://github.com/okx/onchainos-skills --skill okx-agentic-wallet
npx skills add https://github.com/okx/onchainos-skills --skill okx-agent-payments-protocol
```
`okx-ai` = ERC-8004 ASP registration + service listing (X Layer only, `onchainos` CLI, registration is gas-free — OKX pays). `okx-agentic-wallet` is a hard dependency (`okx-ai` preflight reads `../okx-agentic-wallet/_shared/preflight.md`). `okx-agent-payments-protocol` documents the payment layer: **pay-per-call = x402/HTTP 402** — our MCP server's paid tools must return a 402 challenge (`PAYMENT-REQUIRED` header, x402 v2, X Layer chainId 196, USDT/USDG) and verify settlement server-side before doing work. Also still needed: ASP identity registration (agentic wallet), Spotify/YouTube API keys, OpenRouter key for report narration.
