# BLACKBOX — Royalty Leak Scanner & Claim Agent
## Build Specification for OKX.AI Genesis Hackathon (deadline: July 17, 2026, 23:59 UTC)

**Working name:** Blackbox (industry term for unclaimed royalties — rename freely; "Reclaim" is the safe alternative). Referred to as "the ASP" below.

---

## 1. What an ASP is (verified against OKX docs, July 2026)

OKX.AI is an agent-native marketplace. An ASP (Agent Service Provider) is a service listed on that marketplace that other users — or their agents — can discover, call, and pay, with payments settling on X Layer in USDT/USDG stablecoins. There are two ASP modes:

1. **Agent-to-MCP** — a standardized MCP/API service. Pay-per-call, no negotiation. Requires OKX Payment SDK integration before going live. This is what we build.
2. **Agent-to-Agent** — negotiated jobs with escrow, paid after user sign-off, disputes go to staked evaluators. Not v1. (Possible v2: "full claim concierge" as a negotiated job.)

**So the answer to "do we need a frontend": no, not for the ASP itself.** The product IS an MCP server. Users reach it through the OKX.AI marketplace and their agent clients (OpenClaw, Claude Code, Codex, etc.). The one web surface we build is a **hosted report page** — each completed scan returns a shareable URL rendering the leak report. That's not a frontend app; it's a single server-rendered route on the same backend. It exists because (a) screenshots of the report are the viral engine, (b) judges click links, (c) the 90-second demo needs something visual. Total scope: one styled HTML template.

**ASP identity & registration:** agents register on-chain via ERC-8004 identity on X Layer. OKX ships official skills for this — from Claude Code, run:

```bash
npx skills add https://github.com/okx/onchainos-skills --skill okx-ai-guide
```

The `okx-ai-guide` skill is the authoritative source for ASP registration, agentic wallet setup, service listing, and the Payment SDK. **Day-1 task: install it, read it end-to-end, and register the ASP identity immediately** — listing review happens in parallel with the submission window and the ASP must be approved and live by the deadline. Developer docs: `web3.okx.com/onchainos`.

**Hackathon mechanics (verified):** build the ASP → submit for listing on OKX.AI (must pass review and go live or the submission is invalid) → post on X with #OKXAI including a demo (≤90s, embedded in the post — no separate video upload) → submit the Google form before July 17, 23:59 UTC. Non-crypto use cases explicitly welcome. Target categories: **Art/Lifestyle category award, Creative Genius, Social Buzz**; Revenue Rocket is upside, not the plan.

---

## 2. Product definition

**One sentence:** an agent that scans public music-royalty registries to find verified registration gaps on an artist's catalog — money being collected but not paid out because ownership shares are unregistered — then sells a guided claim kit to fix every gap.

**Validated by manual scans (July 2026):**
- Shallipopi's "Speedometer": Total shares **50%**, 76 matched recordings earning across Spotify/Apple/YouTube. Co-writer (Saheeb Haheeb) has no publisher; his half accrues as unclaimed. Shallipopi's own writer IPI blank.
- Rema Namakula (UG) "Muchuzi": Total shares **30%** despite both writers having Songtrust — proof that even "professionally administered" catalogs leak. Also produced the identity-collision lesson (Nigerian Rema ≠ Ugandan Rema) that drives the ISRC verification requirement below.

**Positioning:** Africa-first, not Africa-only. The scan works globally; distribution starts where competition (Notes.fm) has zero presence and the story is strongest.

**The honest epistemic frame (bake into every output):** the registries prove the *gap* (share % registered, publicly verifiable). The dollar amount is always an *estimate* (transparent method, shown as a range). The MLC itself is free to join and claim — we charge for finding gaps and guiding the claim, never for "registration." State this in-product; it's the anti-scam trust line and the legal shield.

---

## 3. Architecture

```
OKX.AI marketplace / user agents
        │  (MCP over streamable HTTP, stateless JSON)
        ▼
┌─────────────────────────────────────────────┐
│  MCP SERVER (TypeScript, MCP SDK)           │
│  Fastify host · RackNerd VPS · Caddy · PM2  │
│  + OKX Payment SDK (pay-per-call gating)    │
├─────────────────────────────────────────────┤
│  IDENTITY RESOLVER   → canonical catalog    │
│  SCAN ORCHESTRATOR   → registry crawlers    │
│  GAP ENGINE          → deterministic rules  │
│  ESTIMATOR           → deterministic math   │
│  REPORT WRITER       → LLM narration only   │
│  CLAIM KIT GENERATOR → guided fix docs      │
├─────────────────────────────────────────────┤
│  Playwright (stealth) workers — MLC portal, │
│  DURP lookup, SoundExchange, PRO repertoires│
│  Postgres: scans, cache, reports            │
│  OpenRouter (Claude Sonnet): extraction +   │
│  narration passes only                      │
└─────────────────────────────────────────────┘
        │
        ▼
  Hosted report route: reports.<domain>/r/{scanId}
```

**Stack decisions (final, don't relitigate):**
- TypeScript + official MCP SDK, streamable HTTP transport, stateless JSON. Zod schemas on every tool input/output. Follow the mcp-builder skill conventions (it's in your Claude Code skills).
- Fastify as the HTTP host (you already run Fastify behind Caddy on the VPS — same pattern as Bezant's api).
- **Playwright with stealth plugin, self-hosted on the VPS** — the MLC portal bot-blocks plain HTTP (verified). Budget real time here; this is the technical risk. Headed-mode fallback via xvfb if stealth headless gets flagged.
- Postgres for scan storage (reuse the VPS instance; new db `blackbox`).
- LLM via OpenRouter. **Two allowed jobs only:** (1) parsing scraped HTML into the schema when selectors are brittle, (2) writing the report narrative from the structured findings. The LLM never decides whether a gap exists and never computes money.

### Non-negotiables (same discipline as the Geeks & Shows API contract)
1. **Never let the LLM compute money or verdicts.** Gap detection and estimation are pure functions.
2. **No leak claim without ISRC-verified identity.** Every flagged work must have ≥1 matched-recording ISRC present in the artist's canonical catalog (the Rema lesson).
3. **Every flag carries provenance:** the source URL + a stored page snapshot. Reports must be independently verifiable.
4. **Estimates are always ranges with the method printed.** Never a single number, never implied certainty about held balances — nobody outside the MLC can see those pre-claim.
5. **Payment success is determined server-side** via the OKX Payment SDK callback/verification — never by the client claiming it paid. (Your rule; it transfers exactly.)
6. **Respectful scraping:** rate-limit (≥3–5s between MLC page loads), cache work pages 7 days, cache artist scans 24h, exponential backoff on blocks. We depend on these registries staying accessible; don't hammer them. Skim the MLC Musical Works Database Terms of Use before launch and add a "not affiliated with The MLC" disclaimer to every report.

---

## 4. Data schema (shared types — write these first)

```ts
type CanonicalTrack = {
  title: string;
  isrcs: string[];              // from MusicBrainz + Spotify
  spotifyId?: string;
  releaseDate?: string;
  streams: { source: 'youtube'|'spotify_scrape'; count: number; asOf: string }[];
};

type CanonicalArtist = {
  queryName: string;
  resolvedName: string;
  aliases: string[];            // stage name, legal name (Crown Uzamah lesson)
  mbid?: string;                // MusicBrainz ID
  spotifyId?: string;
  tracks: CanonicalTrack[];
  disambiguation: { candidates: string[]; confidence: 'high'|'medium'|'low'; notes: string };
};

type MlcWork = {
  title: string;
  mlcSongCode: string;
  iswc?: string;
  writers: { name: string; ipi?: string; role: string }[];
  publishers: { name: string; ipi?: string; collectionShare: number; representedWriters: string[] }[];
  totalShares: number;          // THE number
  matchedRecordings: { artist: string; title: string; isrc?: string; dsp: string; label?: string }[];
  sourceUrl: string;
  snapshotPath: string;         // stored HTML/screenshot for provenance
  fetchedAt: string;
};

type Gap = {
  kind: 'partial_shares' | 'missing_writer_ipi' | 'writer_no_publisher'
       | 'work_not_registered' | 'durp_unmatched_hit' | 'soundexchange_unregistered'
       | 'pro_not_found';
  severity: 'critical' | 'warning' | 'info';
  workRef?: string;             // mlcSongCode
  detail: string;               // deterministic template, not LLM text
  evidence: { url: string; snapshotPath: string };
};

type Estimate = {
  workRef: string;
  method: string;               // printed verbatim in the report
  usStreamEstimate: { low: number; high: number };
  unclaimedShare: number;       // e.g. 0.5
  accruedUsd: { low: number; high: number };
  assumptions: string[];
};

type LeakReport = {
  scanId: string;
  artist: CanonicalArtist;
  works: MlcWork[];
  gaps: Gap[];
  estimates: Estimate[];
  leakScore: number;            // 0–100, deterministic (see §6)
  generatedAt: string;
  reportUrl: string;
};
```

---

## 5. Pipeline (per scan)

**Step 1 — Identity resolution.** Input: artist name (optional: Spotify URL, legal name). Query MusicBrainz (free API, has ISRC links and legal-name aliases) + Spotify Web API (catalog + track ISRCs via `external_ids`). Output `CanonicalArtist`. If multiple plausible candidates (the two Remas), return them and require the caller to pick — never guess on a paid scan.

**Step 2 — Registry crawl (Playwright workers).**
- **MLC Public Work Search** (`portal.themlc.com/search`): search resolved name + aliases + each track title; open every work detail page; extract into `MlcWork`. Paginate matched recordings (Speedometer had 76 across 8 pages).
- **MLC DURP Artist Lookup** (`durp.themlc.com/artist-lookup`) and **Radar Songwriter Lookup** (`radar.themlc.com/songwriter-lookup`): name hits here mean the MLC is holding royalties for unmatched recordings — the most direct "money waiting" signal that exists.
- **SoundExchange** artist/registrant search: registered or not (featured-artist digital performance royalties).
- **PRO repertoires** (ASCAP ACE, BMI): writer name present or absent. v1 can ship with MLC + DURP only if time runs short — that's the demo-critical core.

**Step 3 — ISRC cross-verification.** For each `MlcWork`, intersect `matchedRecordings[].isrc` with `CanonicalArtist` ISRCs. No intersection → work excluded from the report (listed in an appendix as "found under this name, could not verify as yours"). This rule is absolute.

**Step 4 — Gap engine (pure functions, one per `Gap.kind`).** `totalShares < 100` on an earning work → critical. Writer with no publisher/administrator → critical. Missing writer IPI → warning. Catalog track absent from MLC entirely → critical (100% unregistered). DURP hit → critical. Same-verdict-every-run determinism is the credibility of the whole product.

**Step 5 — Estimator (pure function).** US stream estimate from YouTube Data API view counts (official, free) + Spotify play counts where scrapeable, × an assumed US-share band (~25–40% for Afrobeats catalogs; make it a per-scan visible assumption) × the CRB statutory mechanical rate (hard-code current rate with source citation; it's public) × unclaimed share. Output low/high. Print every assumption.

**Step 6 — Report.** LLM writes the narrative strictly from `gaps` + `estimates` JSON (system prompt forbids introducing facts not in the input). Render to the hosted report page — dark theme, one strong headline stat ("50% of Speedometer's songwriter royalties are unclaimed"), per-song cards, evidence links, method footnote, MLC-is-free disclaimer. This page is the screenshot people share; spend design effort here and nowhere else.

**Step 7 — Claim kit (the paid conversion).** Generated from the gaps: correct MLC member type, W-8BEN walkthrough for non-US claimants (the Nigerian-artist reality: no SSN needed, ITIN not required for treaty-benefit basics — verify current MLC guidance during build), exact list of works/shares to claim in the Claiming Tool, parallel PRO registration path, SoundExchange registration if flagged, realistic timeline. Delivered as a personalized document + checklist.

---

## 6. MCP tools (the ASP surface)

| Tool | Price | Description |
|---|---|---|
| `royalty_quick_check` | free | Name in → identity candidates + count of works found + whether obvious gaps exist (yes/no, no details). The hook. |
| `royalty_leak_scan` | $5 | Full pipeline → `LeakReport` (structuredContent) + hosted report URL. |
| `royalty_estimate` | included | Estimation detail for one work from an existing scan. |
| `claim_kit_generate` | $19 | Personalized claim kit from a completed scan. |
| `scan_status` | free | Poll a running scan (crawls take 2–10 min; return a scanId immediately and let agents poll — agent-friendly async). |

Pay-per-call gating on the paid tools via OKX Payment SDK per the okx-ai-guide skill; server-side verification before work starts. Tool descriptions and Zod schemas per the mcp-builder conventions; `readOnlyHint: true` on everything (the ASP never mutates anything external).

**Leak score (deterministic, for the shareable stat):** 100 × weighted(critical gaps × affected-work stream volume ÷ total catalog stream volume). Exact weights are yours; just keep it a pure function.

---

## 7. Seven-day plan (front-load the two risks: scraping + listing review)

- **Day 1 (Jul 10):** Playwright spike against the MLC portal — stealth config until reliable extraction of a work detail page. *Kill criterion: if the portal is not reliably scrapable by end of Day 2, we fall back to the parked ideas — decide then, not later.* In parallel: install okx-ai-guide skill, register ASP identity, read Payment SDK docs.
- **Day 2:** Schemas + MLC crawler complete (search → detail → pagination → snapshots). Gap engine with tests (fixtures: Speedometer, Muchuzi).
- **Day 3:** Identity resolver (MusicBrainz + Spotify) + ISRC verification. DURP/Radar lookups.
- **Day 4:** Estimator + report writer + hosted report page. **Submit the OKX.AI listing today** — review runs in parallel and must complete before the 17th.
- **Day 5:** MCP server assembly + Payment SDK integration + deploy (Caddy route, PM2, same VPS pattern as Bezant). Test with MCP Inspector, then end-to-end through an agent client.
- **Day 6:** Run 5–10 real artist scans for demo material. Polish the report design. SoundExchange/PRO checks if time allows.
- **Day 7 (Jul 16):** Record the 90s demo (structure: MLC page showing "Total shares: 50%" on a hit song → agent runs the scan → report appears with the estimate range → claim kit) → X post with #OKXAI → Google form. Buffer day Jul 17.

**Scope cuts if behind, in order:** PRO checks → SoundExchange → claim kit becomes a templated PDF v1 → estimator becomes stream-count-only ("earning, share unclaimed") with no dollar range.

---

## 8. Claude Code working notes

- Open with this file as the project's CLAUDE.md seed; keep the non-negotiables section verbatim at the top.
- Use the **mcp-builder** skill for server scaffolding and its TypeScript reference guide; use its evaluation phase (10 Q&A evals) against fixture scans before listing submission.
- Fixture-first development: save raw HTML of the Speedometer and Muchuzi pages on Day 1; all extraction and gap-engine tests run against fixtures so the suite never depends on live scraping.
- The scraper worker runs as its own PM2 process (queue via Postgres table, no Redis needed at this scale); MCP server stays stateless.
- Env/secrets in `.env` on the VPS only; the Payment SDK keys and agentic wallet key never enter the repo.

## 9. Risk register (honest)

| Risk | Likelihood | Mitigation |
|---|---|---|
| MLC hardens bot detection | Medium | Stealth + headed fallback + slow crawl + caching; Day-2 kill criterion |
| Listing review rejects/slow | Medium | Submit Day 4; keep service description plain-language and non-crypto-jargon |
| Estimate accuracy challenged | Certain (someone will) | Ranges + printed method + "only claiming reveals the true figure" framing |
| Notes.fm ships Africa targeting | Low (weeks horizon) | Speed + distribution + claim-execution depth they don't have |
| MLC ToU objection to automated access | Low-medium | Rate limits, caching, non-affiliation disclaimer, read ToU Day 1; pivot path: user-initiated "assisted lookup" framing |
| Legal-advice exposure in claim kit | Low | "Educational guidance, not legal advice" disclaimer; never file on the user's behalf in v1 |
