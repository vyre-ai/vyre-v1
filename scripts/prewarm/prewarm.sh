#!/usr/bin/env bash
# Prewarm one CI host (F15). Idempotent: every step is keyed by an input hash and skipped when its input is absent or already warm.
# Run as the runner user on the host; caches live under PREWARM_ROOT (default /var/lib/ci-run/prewarm), which the job-start hook does not wipe.
#   PREWARM_ROOT=dir PREWARM_REPO=url|path PREWARM_REF=ref PREWARM_DRY=1 scripts/prewarm/prewarm.sh
# Output: one line per step "prewarm <step> <ok|warm|skip> <ms>ms <detail>", then "prewarm done failed=N". Exit 1 when any step failed.
set -u
ROOT="${PREWARM_ROOT:-/var/lib/ci-run/prewarm}"
REPO="${PREWARM_REPO:-https://github.com/vyre-ai/vyre-v1.git}"
REF="${PREWARM_REF:-HEAD}"
DRY="${PREWARM_DRY:-0}"
PASS_CACHE="${VYRE_PASS_CACHE:-/var/lib/ci-run/pass-cache-v1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${PREWARM_WORK:-$ROOT/work}"
FAILED=0
now_ms() { date +%s%3N; }
say() { echo "prewarm $1 $2 $(( $(now_ms) - T0 ))ms ${3:-}"; }
step() { # step NAME FUNCTION
  T0=$(now_ms)
  if [ "$DRY" = "1" ]; then say "$1" skip "dry run"; return; fi
  local out rc; out="$("$2" 2>&1)"; rc=$?
  case $rc in
    0) say "$1" ok "$(echo "$out" | tail -1)";;
    10) say "$1" warm "$(echo "$out" | tail -1)";;
    11) say "$1" skip "$(echo "$out" | tail -1)";;
    *) FAILED=$((FAILED + 1)); say "$1" FAIL "$(echo "$out" | tail -3 | tr '\n' ' ')";;
  esac
}
hash_of() { sha256sum "$@" 2>/dev/null | sha256sum | cut -c1-16; }

mkdir -p "$ROOT" "$WORK" 2>/dev/null

# Six runners share a host: one prewarm at a time per host (the others wait, then find everything warm).
if [ "$DRY" != "1" ] && [ -z "${PREWARM_LOCKED:-}" ] && command -v flock >/dev/null; then
  exec env PREWARM_LOCKED=1 flock "$ROOT/.lock" "${BASH_SOURCE[0]}" "$@"
fi
# A private repo needs the job token; it goes in as a one-shot header and is never written to the mirror config.
GIT_AUTH=(); [ -n "${PREWARM_TOKEN:-}" ] && GIT_AUTH=(-c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$PREWARM_TOKEN" | base64 -w0)")

s_mirror() { # bare mirror of the repo, so checkout only fetches the delta
  local m="$ROOT/repo.git"
  if [ -d "$m" ]; then git "${GIT_AUTH[@]}" -C "$m" remote update --prune >/dev/null 2>&1 || return 1; echo "fetched $(git -C "$m" rev-parse --short HEAD)"; return 0; fi
  git "${GIT_AUTH[@]}" clone --mirror -q "$REPO" "$m" || return 1; echo "cloned"
}
checkout() { # a scratch checkout of REF from the mirror, used by the steps below
  rm -rf "$WORK/src"; git clone -q "$ROOT/repo.git" "$WORK/src" && git -C "$WORK/src" checkout -q "$REF" 2>/dev/null || git -C "$WORK/src" checkout -q FETCH_HEAD 2>/dev/null || true
}
s_node_modules() { # npm ci once per lockfile hash; jobs copy or hardlink the tree
  local lock="$WORK/src/package-lock.json"; [ -f "$lock" ] || { echo "no package-lock.json yet"; return 11; }
  local k; k="$(hash_of "$lock" "$WORK/src/package.json")"; local d="$ROOT/node_modules/$k"
  [ -d "$d/node_modules" ] && { echo "warm $k"; return 10; }
  mkdir -p "$d" && cp "$WORK/src/package.json" "$lock" "$d/" && (cd "$d" && npm ci --ignore-scripts --no-audit --no-fund --cache "$ROOT/npm-cache" >/dev/null) || { rm -rf "$d"; return 1; }
  echo "installed $k"
}
s_playwright() {
  grep -q '"playwright\|"@playwright/test' "$WORK/src/package.json" 2>/dev/null || { echo "no playwright dependency yet"; return 11; }
  PLAYWRIGHT_BROWSERS_PATH="$ROOT/playwright" npx --yes playwright install chromium >/dev/null || return 1; echo "chromium in $ROOT/playwright"
}
s_docker() { # layers: pull every image named in ci/fleet/images.txt
  local f="$HERE/../../ci/fleet/images.txt"; [ -s "$f" ] && command -v docker >/dev/null || { echo "no images listed or no docker"; return 11; }
  local n=0; while read -r img; do case "$img" in ""|\#*) continue;; esac; docker pull -q "$img" >/dev/null || return 1; n=$((n + 1)); done < "$f"; echo "pulled $n images"
}
s_template_dbs() { # sqlite templates are built by the repo's own script once it exists
  local s="$WORK/src/scripts/prewarm/template-dbs.sh"; [ -x "$s" ] || { echo "no template-dbs.sh yet"; return 11; }
  PREWARM_ROOT="$ROOT" "$s" >/dev/null || return 1; echo "templates built"
}
s_tsbuildinfo() { # keep tsbuildinfo per tsconfig hash so tsc -b is incremental on a fresh checkout
  ls "$WORK/src"/tsconfig*.json >/dev/null 2>&1 || { echo "no tsconfig yet"; return 11; }
  mkdir -p "$ROOT/tsbuildinfo"; local k; k="$(hash_of "$WORK/src"/tsconfig*.json)"
  [ -d "$ROOT/tsbuildinfo/$k" ] && { echo "warm $k"; return 10; }
  mkdir -p "$ROOT/tsbuildinfo/$k"; echo "slot $k ready (filled by the first typecheck job)"
}
s_rust() {
  [ -f "$WORK/src/Cargo.lock" ] || { echo "no Cargo.lock yet"; return 11; }
  command -v cargo >/dev/null || { echo "no cargo on host"; return 11; }
  (cd "$WORK/src" && CARGO_HOME="$ROOT/cargo" cargo fetch --locked >/dev/null) || return 1; echo "crates fetched"
}
s_pass_cache() { mkdir -p "$PASS_CACHE" && echo "$(find "$PASS_CACHE" -type f 2>/dev/null | wc -l) entries in $PASS_CACHE"; }
s_expo() {
  [ -f "$WORK/src/client/app.json" ] || [ -f "$WORK/src/client/app.config.ts" ] || { echo "no expo client yet"; return 11; }
  mkdir -p "$ROOT/expo-export"; echo "slot ready"
}

step mirror s_mirror
if [ "$DRY" != "1" ] && [ -d "$ROOT/repo.git" ]; then checkout; fi
step node_modules s_node_modules
step playwright s_playwright
step docker s_docker
step template_dbs s_template_dbs
step tsbuildinfo s_tsbuildinfo
step rust s_rust
step pass_cache s_pass_cache
step expo s_expo
echo "prewarm done failed=$FAILED host=$(hostname)"
[ "$FAILED" = "0" ]
