#!/usr/bin/env bash
# Download artifacts of this workflow run, each retried, all at once:  fetch-artifacts.sh <artifact-name>=<directory> ...
# Env: GH_TOKEN (needs actions: read), GITHUB_RUN_ID, GITHUB_REPOSITORY, and optionally FETCH_ATTEMPTS (default 3), FETCH_TRY_SECONDS (a limit on one try, default 420), FETCH_PAUSE (default 10).
# Why: publish used actions/download-artifact one artifact after another on a self-hosted runner and timed out at its 30 minute cap on rc.21, rc.22 and rc.23 (a 127 MB file took 25 minutes at
# 85 KB/s). Each try here has its own limit, so one hung transfer is cut and tried again instead of eating the whole job, and the artifacts come down side by side. A short try limit is not a longer
# job limit: three tries of 7 minutes fit inside the job's 30. An artifact that never arrives fails the job; nothing is skipped.
set -uo pipefail
attempts="${FETCH_ATTEMPTS:-3}"; limit="${FETCH_TRY_SECONDS:-420}"; pause="${FETCH_PAUSE:-10}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is needed}" "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is needed}" "${GH_TOKEN:?GH_TOKEN is needed}"
[ "$#" -gt 0 ] || { echo "usage: fetch-artifacts.sh <artifact-name>=<directory> ..."; exit 2; }

fetch_one() {
  local name="$1" dir="$2" n tmp src
  for n in $(seq 1 "$attempts"); do
    tmp="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fetch-XXXXXX")"
    if timeout "$limit" gh run download "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" -n "$name" -D "$tmp" >"$tmp.log" 2>&1; then
      # one artifact named with -n lands in the directory itself; an older gh puts it in a folder named for the artifact
      src="$tmp"; [ -d "$tmp/$name" ] && [ "$(find "$tmp" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ] && src="$tmp/$name"
      if [ -n "$(find "$src" -type f -print -quit)" ]; then
        mkdir -p "$dir" && cp -a "$src/." "$dir/" && rm -rf "$tmp" "$tmp.log" && echo "fetched $name into $dir (try $n of $attempts)" && return 0
      fi
      echo "try $n of $attempts for $name: the download held no files"
    else
      echo "try $n of $attempts for $name failed: $(tail -n 2 "$tmp.log" | tr '\n' ' ')"
    fi
    rm -rf "$tmp" "$tmp.log"
    [ "$n" -lt "$attempts" ] && sleep "$((pause * n))"
  done
  echo "could not fetch the artifact $name after $attempts tries"
  return 1
}

pids=(); names=()
for pair in "$@"; do
  name="${pair%%=*}"; dir="${pair#*=}"
  [ -n "$name" ] && [ "$name" != "$pair" ] && [ -n "$dir" ] || { echo "bad argument '$pair': want <artifact-name>=<directory>"; exit 2; }
  fetch_one "$name" "$dir" & pids+=("$!"); names+=("$name")
done
rc=0
for i in "${!pids[@]}"; do wait "${pids[$i]}" || { echo "FAILED: ${names[$i]}"; rc=1; }; done
exit "$rc"
