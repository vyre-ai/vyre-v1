#!/usr/bin/env bash
# Regen bot (ruling 22), run by .github/workflows/regen.yml on a build/* branch after manifests/ or host/modules.json changed.
#   1. node tools/gen/src/cli.ts writes generated/ in place.
#   2. npm install --package-lock-only refreshes package-lock.json. If generated/ or the lockfile differs, commit it as Irfad Imtiaz with "chore(gen): regenerate" and push to the same branch.
#   3. Rerun the checks on the resulting head (contracts gate, then the affected tests) and publish the result as the
#      commit status "regen-checks". Needed because a GITHUB_TOKEN push does not trigger the check workflow.
# Env: BRANCH, PUSHED_SHA, BEFORE (optional), GH_TOKEN, REPO. Local dry run: DRY_RUN=1 skips push and statuses.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BRANCH:?BRANCH is required}"
DRY_RUN="${DRY_RUN:-0}"

MAIN=0
case "$BRANCH" in
  build/*) ;;
  main) MAIN=1 ;;   # after every merge to main (not wired: main is behind a merge queue the bot cannot push to): rebuild generated/ and the snapshots so main is never behind its manifests
  *) echo "regen: refusing to run on $BRANCH (build/* and main only)"; exit 1;;
esac

status() { # state description
  [ "$DRY_RUN" = "1" ] && { echo "status $1: $2"; return 0; }
  local sha; sha="$(git rev-parse HEAD)"
  STATE="$1" DESC="$2" SHA="$sha" TARGET="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-0}" node -e '
    const e = process.env;
    fetch(`https://api.github.com/repos/${e.REPO}/statuses/${e.SHA}`, {
      method: "POST",
      headers: { authorization: `Bearer ${e.GH_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ state: e.STATE, context: "regen-checks", description: e.DESC.slice(0, 140), target_url: e.TARGET }),
    }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); }).catch((x) => console.log("regen: could not post status: " + x.message));
  '
}

echo "== regenerate =="
node tools/gen/src/cli.ts
echo "== snapshots =="
# docs/frozen/snapshots: one small file per manifest (lib/snapshot.ts). Written here so a worker never records a hash by hand and two PRs on different manifests never conflict.
node tools/gen/src/cli.ts --snapshots

echo "== lockfile =="
# npm never runs on the workers' Macs, so the lockfile is refreshed here whenever a package.json changed.
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

echo "== prototype seed =="
# The prototype seed (apps/app/src/fixtures/prototype-seed.generated.json) is built from the prototype HTML by a pure-node script (about 10 s, no install). Same pattern as the lockfile.
if [ -f scripts/shots/gen-prototype-seed.mjs ]; then node scripts/shots/gen-prototype-seed.mjs --write; fi
SEED=apps/app/src/fixtures/prototype-seed.generated.json

SNAP=docs/frozen/snapshots
if [ -n "$(git status --porcelain -- generated $SNAP package-lock.json $SEED)" ]; then
  git config user.name "Irfad Imtiaz"
  git config user.email "130136633+irfad7@users.noreply.github.com"
  gen_changed="$(git status --porcelain -- generated $SNAP package-lock.json)"
  seed_changed="$(git status --porcelain -- $SEED)"
  [ -n "$gen_changed" ] && { git add -A -- generated $SNAP package-lock.json; git commit -q -m "chore(gen): regenerate"; }
  [ -n "$seed_changed" ] && { git add -A -- $SEED; git commit -q -m "chore(gen): prototype seed"; }
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry run: committed locally, not pushing"
  elif ! git push origin "HEAD:refs/heads/${BRANCH}"; then
    # The worker pushed again while this ran. That push starts a fresh regen run on the newer head, so stop here.
    # On main the same happens when another merge landed first (its own run rebuilds) or when main refuses a bot push: say so loudly, the next merge's run tries again.
    echo "regen: push rejected (branch moved or protected); the newer push triggers its own regen run"
    exit 0
  fi
  echo "regen: committed generated files ($(git rev-parse --short HEAD))"
  # A push made with GITHUB_TOKEN starts no workflow, so the required check would never attach to this head. A dispatch made with the same token is allowed to start one.
  if [ "$MAIN" != "1" ] && [ "$DRY_RUN" != "1" ]; then
    if gh workflow run check.yml --ref "$BRANCH"; then echo "regen: dispatched check.yml on $BRANCH"; else echo "regen: could not dispatch check.yml on $BRANCH (the required check will be missing on the bot's head)"; fi
  fi
else
  echo "regen: generated/ already matches the manifests, nothing to commit"
fi

if [ "$MAIN" = "1" ]; then echo "regen: main is rebuilt, no checks to rerun here"; exit 0; fi
echo "== rerun checks on $(git rev-parse --short HEAD) =="
status pending "contracts gate and affected tests running"
fail=""
tools/gen/check.sh || fail="contracts gate failed"

if [ -z "$fail" ]; then
  # the branch's merge-base with main, not the previous push, so every test the branch touches runs
  git fetch -q origin main 2>/dev/null || true
  base="$(git merge-base origin/main HEAD 2>/dev/null || echo origin/main)"
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
