#!/usr/bin/env bash
# E2E bootstrap verification — run from repo root after deploy or locally.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ARTIFACT="${ROOT}/verify-bootstrap.log"

{
  echo "=== SohoPay agent skills bootstrap verify ==="
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo

  echo "--- npm validate ---"
  npm run generate:llms-full
  npm run validate

  echo
  echo "--- index.json schema ---"
  node -e "
    const fs = require('fs');
    const idx = JSON.parse(fs.readFileSync('.well-known/agent-skills/index.json','utf8'));
    if (!idx.skills?.length) throw new Error('no skills');
    for (const s of idx.skills) {
      if (!s.name || !s.url) throw new Error('invalid skill entry');
    }
    console.log('index.json OK:', idx.skills.length, 'skills');
  "

  echo
  echo "--- registry list ---"
  REGISTRY_OUT="$(npx skills add . --list -y 2>&1)" || true
  echo "$REGISTRY_OUT"
  echo "$REGISTRY_OUT" | grep -q sohopay-integrate

  echo
  echo "--- hosted URL probe (optional; requires deploy) ---"
  BASE="${AGENTS_SKILLS_BASE_URL:-https://agents.sohopay.xyz}"
  if curl -sfL --max-time 10 "${BASE}/skills/setup.md" -o /tmp/sohopay-setup.md; then
    if grep -q "SohoPay" /tmp/sohopay-setup.md; then
      echo "setup.md reachable at ${BASE}"
    else
      echo "WARN: ${BASE}/skills/setup.md returned unexpected content"
    fi
  else
    echo "SKIP: ${BASE}/skills/setup.md not yet deployed (expected before CDN go-live)"
  fi

  echo
  echo "=== PASS ==="
} 2>&1 | tee "$ARTIFACT"

echo "Wrote $ARTIFACT"
