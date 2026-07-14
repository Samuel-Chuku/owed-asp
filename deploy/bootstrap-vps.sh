#!/usr/bin/env bash
# One-time VPS bootstrap for the Owed ASP (Docker path). Run as the deploy user.
#   curl -fsSL <raw-url>/deploy/bootstrap-vps.sh | bash -s -- <git-clone-url>
set -euo pipefail

REPO_URL="${1:?usage: bootstrap-vps.sh <git-clone-url>}"

# 1. Docker (skip if present)
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo ">> Docker installed. Log out/in (or newgrp docker) so group membership applies, then re-run this script."
  exit 0
fi

# 2. Code
if [ ! -d "$HOME/owed" ]; then
  git clone "$REPO_URL" "$HOME/owed"
fi
cd "$HOME/owed"

# 3. Environment
if [ ! -f .env ]; then
  cp .env.example .env
  echo ">> EDIT ~/owed/.env NOW (PUBLIC_BASE_URL, YOUTUBE_API_KEY, payment vars later), then re-run."
  exit 0
fi

# 4. Up
mkdir -p data
docker compose up -d --build
sleep 5
curl -sf http://127.0.0.1:8402/healthz && echo "" && echo ">> Owed ASP is up on 127.0.0.1:8402"

echo ">> Remaining (once): append deploy/Caddyfile.snippet to /etc/caddy/Caddyfile and 'sudo systemctl reload caddy'."
