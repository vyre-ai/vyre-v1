#!/usr/bin/env bash
# Regen bot (ruling 22), run by .github/workflows/regen.yml on a build/* branch after manifests/ or host/modules.json changed.
#   1. node tools/gen/src/cli.ts writes generated/ in place.
#   2. If generated/ differs, commit it as Irfad Imtiaz with "chore(gen): regenerate" and push to the same branch.
#   3. Rerun the checks on the resulting head (contracts gate, then the affected tests) and publish the result as the
#      commit status "regen-checks". Needed because a GITHUB_TOKEN push does not trigger the check workflow.
# Env: BRANCH, PUSHED_SHA, BEFORE (optional), GH_TOKEN, REPO. Local dry run: DRY_RUN=1 skips push and statuses.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BRANCH:?BRANCH is required}"
DRY_RUN="${DRY_RUN:-0}"

case "$BRANCH" in build/*) ;; *) echo "regen: refusing to run on $BRANCH (build/* only)"; exit 1;; esac

status() { # state description
  [ "$DRY_RUN" = "1" ] && { echo "status $1: $2"; return 0; }
  local sha; sha="$(git rev-parse HEAD)"
  gh api -X POST "repos/${REPO}/statuses/${sha}" -f state="$1" -f context="regen-checks" -f description="$2" \
    -f target_url="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-0}" >/dev/null || echo "regen: could not post status"
}

echo "== regenerate =="
node tools/gen/src/cli.ts

if [ -n "$(git status --porcelain -- generated)" ]; then
  git config user.name "Irfad Imtiaz"
  git config user.email "130136633+irfad7@users.noreply.github.com"
  git add -A -- generated
  git commit -q -m "chore(gen): regenerate"
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry run: committed locally, not pushing"
  elif ! git push origin "HEAD:refs/heads/${BRANCH}"; then
    # The worker pushed again while this ran. That push starts a fresh regen run on the newer head, so stop here.
    echo "regen: push rejected (branch moved); the newer push triggers its own regen run"
    exit 0
  fi
  echo "regen: committed generated/ ($(git rev-parse --short HEAD))"
else
  echo "regen: generated/ already matches the manifests, nothing to commit"
fi

echo "== rerun checks on $(git rev-parse --short HEAD) =="
status pending "contracts gate and affected tests running"
fail=""
tools/gen/check.sh || fail="contracts gate failed"

if [ -z "$fail" ]; then
  base="${BEFORE:-}"
  if [ -z "$base" ] || echo "$base" | grep -Eq '^0+$' || ! git rev-parse --verify -q "$base" >/dev/null; then base=origin/main; fi
  node scripts/ci-select.ts "$base" > "${RUNNER_TEMP:-/tmp}/regen-select.json" || fail="selection failed (uncovered code)"
fi

if [ -z "$fail" ]; then
  files="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=r.all?[]:r.files;console.log(f.join(" "))' "${RUNNER_TEMP:-/tmp}/regen-select.json")"
  all="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).all)' "${RUNNER_TEMP:-/tmp}/regen-select.json")"
  if [ "$all" = "true" ]; then
    echo "regen: selection says run everything; the regular check workflow covers that, running the frozen and generated tests only"
    files="$(git ls-files | grep -E '(^|/)(frozen-[^/]*|[^/]*)\.test\.[cm]?[jt]s$' | grep -E '^generated/|/frozen-' | tr '\n' ' ')"
  fi
  if [ -n "$files" ]; then
    # shellcheck disable=SC2086
    node scripts/test-run.mjs --files $files || fail="affected tests failed"
  else
    echo "regen: no affected tests"
  fi
fi

if [ -n "$fail" ]; then status failure "$fail"; echo "regen: $fail"; exit 1; fi
status success "contracts gate and affected tests passed"
echo "regen: checks passed"
