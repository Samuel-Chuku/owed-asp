# Owed ASP — deploy (Docker + CI/CD)

Target: RackNerd VPS, host Caddy terminating TLS, app in Docker, GitHub Actions
deploying on every push to main. Production endpoint: https://useowed.xyz/mcp

## One-time setup

**0. DNS (Cloudflare):** A record `useowed.xyz` → VPS IP, **DNS-only (grey
cloud)** — Caddy needs to issue its own certificate.

**1. VPS bootstrap** (as your deploy user):

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/bootstrap-vps.sh | bash -s -- <git-clone-url>
```

The script is re-runnable; it stops and tells you when to act (Docker group
re-login, editing `.env`). `.env` needs: `PUBLIC_BASE_URL=https://useowed.xyz`,
`YOUTUBE_API_KEY`, `PAYMENT_MODE=off` (until registration wiring lands).

**2. Caddy:** append `deploy/Caddyfile.snippet` to `/etc/caddy/Caddyfile`,
then `sudo systemctl reload caddy`.

**3. CI/CD secrets** (GitHub repo → Settings → Secrets and variables →
Actions): `VPS_HOST` (IP), `VPS_USER`, `VPS_SSH_KEY` (private key whose public
half is in the VPS `~/.ssh/authorized_keys`), optional `VPS_PORT`.

From then on: **every push to main = typecheck + 38 tests on CI, then
container rebuild on the VPS with a health check.** A failed test blocks the
deploy.

## Verify

```bash
curl https://useowed.xyz/healthz
curl -s -X POST https://useowed.xyz/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Run one scan through the endpoint and open its /r/{scanId} page — that URL is
the demo.

## Frontend (Vercel)

Import the repo in Vercel, set root directory to `frontend/`, env vars
`NEXT_PUBLIC_API_BASE=https://useowed.xyz` and (once live)
`NEXT_PUBLIC_LISTING_URL`. Vercel auto-deploys `frontend/` changes on push —
same CI/CD-from-git model as the backend.

## Notes

- `data/` is the only state (cache, snapshots, jobs, scans); it's a bind mount
  and survives rebuilds. Back it up if scan history matters.
- Manual deploy (if Actions is down): `cd ~/owed && git pull && docker compose up -d --build`.
- Non-Docker fallback (PM2): `deploy/ecosystem.config.cjs` still works —
  `npm ci && pm2 start deploy/ecosystem.config.cjs`.
- When ASP registration completes: set `PAYMENT_MODE=x402`, `PAYMENT_PAY_TO`,
  `PAYMENT_USDT_ADDRESS`, `PAYMENT_FACILITATOR_URL` in `.env`, then
  `docker compose up -d` (settlement verification must be wired in
  src/server/payment.ts first — until then x402 mode refuses paid calls).
- Set `LISTING_URL` in `.env` once the OKX.AI listing is live (report CTAs).
