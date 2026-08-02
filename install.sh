#!/usr/bin/env bash
#
# SohoPay skills installer — deterministic, auditable, non-agent path.
#
# For operators and CI who want a classic installer instead of the
# agent-driven `setup.md` flow. Readable top-to-bottom on purpose: this is a
# payments product, so nothing here is obfuscated.
#
# Usage:
#   ./install.sh [--harness claude|cursor|codex] [--key <api-key>] [--base <url>]
#
#   --harness   Target agent harness. Auto-detected if omitted.
#   --key       SohoPay MCP token. Prompted (hidden) if omitted. Never written
#               to a file by this script; exported to the environment / passed
#               to the harness's own secret store only.
#   --base      Base URL serving the skill docs.
#               Default (dev): https://raw.githubusercontent.com/sohopay/skills/main
#               At launch:     https://agents.sohopay.xyz/skills/v1
#
# Idempotent: safe to re-run. Existing skills are refreshed; an already-registered
# MCP server is left in place.

set -euo pipefail

# --- Configuration -----------------------------------------------------------

DEFAULT_BASE="https://raw.githubusercontent.com/sohopay/skills/main"
MCP_URL="https://mcp.sohopay.xyz"   # TODO(confirm): real hosted MCP URL once deployed
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=13
MIN_NPM_MAJOR=10

HARNESS=""
KEY="${SOHO_TOKEN:-}"
BASE="$DEFAULT_BASE"

# --- Helpers -----------------------------------------------------------------

err()  { printf 'ERROR: %s\n' "$*" >&2; }
info() { printf '==> %s\n' "$*"; }
die()  { err "$*"; exit 1; }

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# --- Parse flags -------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --harness) HARNESS="${2:-}"; shift 2 ;;
    --key)     KEY="${2:-}"; shift 2 ;;
    --base)    BASE="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) err "unknown argument: $1"; usage 1 ;;
  esac
done

BASE="${BASE%/}"   # strip trailing slash

# --- Step 1: prerequisites ---------------------------------------------------

info "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0 is required."
command -v npm  >/dev/null 2>&1 || die "npm >= ${MIN_NPM_MAJOR} is required."
command -v curl >/dev/null 2>&1 || die "curl is required."

node_ver="$(node -p 'process.versions.node')"
node_major="${node_ver%%.*}"
node_rest="${node_ver#*.}"; node_minor="${node_rest%%.*}"
if (( node_major < MIN_NODE_MAJOR )) || { (( node_major == MIN_NODE_MAJOR )) && (( node_minor < MIN_NODE_MINOR )); }; then
  die "Node.js ${node_ver} is too old; need >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0."
fi

npm_ver="$(npm -v)"
if (( ${npm_ver%%.*} < MIN_NPM_MAJOR )); then
  die "npm ${npm_ver} is too old; need >= ${MIN_NPM_MAJOR}."
fi

# --- Step 2: detect harness --------------------------------------------------

if [[ -z "$HARNESS" ]]; then
  info "Detecting agent harness"
  detected=()
  command -v claude >/dev/null 2>&1 && detected+=("claude")
  [[ -d "$HOME/.cursor" ]]          && detected+=("cursor")
  command -v codex  >/dev/null 2>&1 && detected+=("codex")

  if [[ ${#detected[@]} -eq 1 ]]; then
    HARNESS="${detected[0]}"
  elif [[ ${#detected[@]} -eq 0 ]]; then
    die "No harness detected. Re-run with --harness claude|cursor|codex."
  else
    die "Multiple harnesses detected (${detected[*]}). Re-run with --harness to disambiguate."
  fi
fi

case "$HARNESS" in
  claude|cursor|codex) ;;
  *) die "Unsupported harness: $HARNESS (expected claude|cursor|codex)." ;;
esac
info "Harness: $HARNESS"

# --- Step 3: skills directory ------------------------------------------------
# TODO(confirm): exact per-harness global skills directory for current versions.

case "$HARNESS" in
  claude) SKILLS_DIR="$HOME/.claude/skills/sohopay" ;;
  cursor) SKILLS_DIR="$HOME/.cursor/skills/sohopay" ;;
  codex)  SKILLS_DIR="$HOME/.codex/skills/sohopay" ;;
esac

info "Skills directory: $SKILLS_DIR"
mkdir -p "$SKILLS_DIR"

# --- Step 4: download skill docs ---------------------------------------------

info "Fetching skill index"
index_json="$(curl -fsSL "${BASE}/.well-known/agent-skills/index.json")" \
  || die "Could not fetch ${BASE}/.well-known/agent-skills/index.json"

# Derive the skill filenames from the index (node is guaranteed present).
# Portable read loop — mapfile is bash 4+ and macOS ships bash 3.2.
skill_files=()
while IFS= read -r line; do
  [[ -n "$line" ]] && skill_files+=("$line")
done < <(printf '%s' "$index_json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const k of JSON.parse(s).skills)console.log(k.name+".md")})')

[[ ${#skill_files[@]} -gt 0 ]] || die "Skill index contained no skills."

downloaded=()
for f in "${skill_files[@]}"; do
  info "Downloading $f"
  curl -fsSL "${BASE}/${f}" -o "${SKILLS_DIR}/${f}" || die "Failed to download ${BASE}/${f}"
  downloaded+=("$f")
done

# --- Step 5: register MCP server ---------------------------------------------
# The key is never written to a file by this script. For Claude Code it is handed
# to the CLI's own managed store; for Cursor/Codex the config references the
# ${SOHO_TOKEN} environment variable, which you export yourself.

if [[ -z "$KEY" ]]; then
  # Prompt without echoing; skip in non-interactive contexts.
  if [[ -t 0 ]]; then
    read -rsp "SohoPay MCP token (input hidden, not stored): " KEY; echo
  fi
fi

register_note=""
case "$HARNESS" in
  claude)
    if claude mcp get sohopay >/dev/null 2>&1; then
      register_note="already registered (left in place)"
    elif [[ -n "$KEY" ]]; then
      # TODO(confirm): exact auth header shape.
      claude mcp add sohopay --transport http "$MCP_URL" \
        --header "Authorization: Bearer ${KEY}"
      register_note="registered via 'claude mcp add'"
    else
      register_note="SKIPPED — no token; run: claude mcp add sohopay --transport http $MCP_URL --header \"Authorization: Bearer \$SOHO_TOKEN\""
    fi
    ;;
  cursor)
    register_note="config references \${SOHO_TOKEN}; export it, then add to ~/.cursor/mcp.json — see mcp-connect.md"
    ;;
  codex)
    register_note="config references \${SOHO_TOKEN}; export it, then add to ~/.codex/config.toml — see mcp-connect.md"
    ;;
esac

# --- Step 6: read-only verification ------------------------------------------

info "Verifying MCP reachability (read-only)"
verify_note=""
if curl -fsSL --max-time 10 "${MCP_URL}/health" -o /dev/null 2>/dev/null; then
  verify_note="health OK at ${MCP_URL}/health"
else
  verify_note="SKIP — ${MCP_URL}/health not reachable yet (expected before MCP go-live)"
fi

# --- Step 7: summary ---------------------------------------------------------

cat <<SUMMARY

------------------------------------------------------------
SohoPay install summary
------------------------------------------------------------
Harness:        $HARNESS
Skills base:    $BASE
Skills dir:     $SKILLS_DIR
Skills written: ${downloaded[*]}
MCP server:     $MCP_URL
MCP register:   $register_note
Verification:   $verify_note

Next: open borrower-onboard.md in the skills dir and complete
onboarding. Repayment is due weekly, on Sunday, settled by the operator.
The MCP token was not written to any file by this script.
------------------------------------------------------------
SUMMARY
