#!/usr/bin/env bash
# CI dependencies without an npm ci in every job (P-CI_08).
# One node_modules set per lockfile hash lives on the runner host, outside the per-runner HOME/TMPDIR that the job-start hook wipes.
# A job hardlinks that set into its workspace (seconds, no CPU). Only a miss runs npm ci, once per host, under a lock; the other runners wait for it.
#   bash scripts/ci-deps.sh [workspace]       default workspace: $GITHUB_WORKSPACE or the current directory
# Env: VYRE_DEPS_CACHE (default /var/lib/ci-run/deps-cache), VYRE_DEPS_KEEP (sets kept besides the one in use, default 3), VYRE_DEPS_WAIT (seconds to wait for another preparer, default 600).
# Output: "deps <hit|miss|wait> key=<k> dirs=<n> <ms>ms"; with GITHUB_OUTPUT set also hit=<true|false> and key=<k>.
# The workspace also gets the .deps-ready-<key> marker that scripts/shots/ensure-deps.mjs checks, so it never runs its own npm ci.
set -euo pipefail
WS="$(cd "${1:-${GITHUB_WORKSPACE:-.}}" && pwd)"
CACHE="${VYRE_DEPS_CACHE:-/var/lib/ci-run/deps-cache}"
KEEP="${VYRE_DEPS_KEEP:-3}"
WAIT="${VYRE_DEPS_WAIT:-600}"
T0=$(date +%s%3N)
cd "$WS"
[ -f package-lock.json ] || { echo "deps skip: no package-lock.json (run the shots lockfile job first)"; exit 0; }

# Key: lockfile plus every tracked package.json plus the toolchain, so a dependency or node/npm change prepares a new set.
manifests() { { git ls-files -- 'package.json' '*/package.json' 2>/dev/null || find . -name package.json -not -path '*/node_modules/*' | sed 's#^\./##'; } | sort; }
KEY="$({ for f in package-lock.json $(manifests); do printf '%s\0' "$f"; cat "$f"; done; node -v; npm -v; uname -m; } | sha256sum | cut -c1-16)"

# The key scripts/shots/ensure-deps.mjs computes (its fixed file list), so the marker it looks for exists.
ensure_key() { { for f in package.json package-lock.json ui/package.json scripts/shots/app/package.json apps/app/package.json; do printf '%s\0' "$f"; [ -f "$f" ] && cat "$f"; done; } | sha256sum | cut -c1-16; }

mkdir -p "$CACHE"
SET="$CACHE/$KEY"

prepare() { # build the set in a private directory and move it into place in one rename
  local tmp="$CACHE/.tmp-$KEY-$$"
  rm -rf "$tmp"; mkdir -p "$tmp/src"
  for f in package-lock.json $(manifests); do mkdir -p "$tmp/src/$(dirname "$f")"; cp "$f" "$tmp/src/$f"; done
  [ -f .npmrc ] && cp .npmrc "$tmp/src/.npmrc"
  ( cd "$tmp/src" && npm ci --ignore-scripts --no-audit --no-fund --cache "$CACHE/npm-cache" >&2 )
  ( cd "$tmp/src" && find . -name node_modules -type d -prune | sed 's#^\./##' | sort ) > "$tmp/dirs"
  mkdir -p "$tmp/tree"
  while read -r d; do mkdir -p "$tmp/tree/$(dirname "$d")"; mv "$tmp/src/$d" "$tmp/tree/$d"; done < "$tmp/dirs"
  rm -rf "$tmp/src"
  find "$tmp/tree" -type f -exec chmod a-w {} + 2>/dev/null || true   # files only: a job that writes into a hardlinked file fails loudly instead of corrupting the set; directories stay writable for tool caches
  mv "$tmp" "$SET"
}

STATE=hit
if [ ! -f "$SET/dirs" ]; then
  STATE=miss
  # One preparer per host and key; the rest block here (flock) and then find the set ready.
  exec 9>"$CACHE/.lock-$KEY"
  if ! flock -w "$WAIT" 9; then echo "deps FAIL: waited ${WAIT}s for another runner to prepare $KEY" >&2; exit 1; fi
  if [ -f "$SET/dirs" ]; then STATE=wait; else rm -rf "$SET"; prepare; fi
  flock -u 9
fi

# Per-runner copy: hardlinks when the cache and workspace share a filesystem, a plain copy otherwise.
n=0
while read -r d; do
  [ -n "$d" ] || continue
  chmod -R u+w "$WS/$d" 2>/dev/null || true
  rm -rf "${WS:?}/$d"; mkdir -p "$WS/$(dirname "$d")"
  cp -al "$SET/tree/$d" "$WS/$d" 2>/dev/null || cp -a "$SET/tree/$d" "$WS/$d"
  n=$((n + 1))
done < "$SET/dirs"
mkdir -p "$WS/node_modules" && echo ok > "$WS/node_modules/.deps-ready-$(ensure_key)" 2>/dev/null || true
touch "$SET"   # recency for the prune below

# Keep the newest sets; remove stale temp directories from a crashed preparer.
ls -1dt "$CACHE"/*/ 2>/dev/null | grep -v '/npm-cache/$' | tail -n +$((KEEP + 2)) | while read -r old; do chmod -R u+w "$old" 2>/dev/null; rm -rf "$old"; done || true
find "$CACHE" -maxdepth 1 -name '.tmp-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true

MS=$(( $(date +%s%3N) - T0 ))
echo "deps $STATE key=$KEY dirs=$n ${MS}ms"
if [ -n "${GITHUB_OUTPUT:-}" ]; then { echo "key=$KEY"; echo "hit=$([ "$STATE" = miss ] && echo false || echo true)"; echo "ms=$MS"; } >> "$GITHUB_OUTPUT"; fi
