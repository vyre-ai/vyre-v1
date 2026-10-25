#!/usr/bin/env bash
# Host-level disk lock between the perf runner and the Docker-heavy jobs (P-CI_31, ruling 46).
# Measured on vyre-ci-1: shared disk journal contention is not isolated by cgroup IO weights (no BFQ; iocost with the default model did not hold p95 under 10 ms),
# so a perf job runs alone on the disk: it takes the exclusive lock, and heavy jobs hold the shared lock for their whole run.
#   bash scripts/ci-iolock.sh shared|exclusive
# The lock is held by a background process that the runner's orphan cleanup kills when the job ends, so there is no release step.
# No-op on GitHub-hosted runners. A waiting perf job blocks new heavy jobs (marker file) so it cannot starve.
set -uo pipefail
mode="${1:?shared|exclusive}"
[ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ] && exit 0
L=/var/tmp/vyre-io.lock; W=/var/tmp/vyre-io.perf-waiting
touch "$L" 2>/dev/null || { echo "iolock: cannot use $L, continuing without it"; exit 0; }
if [ "$mode" = "exclusive" ]; then
  touch "$W"
  ( setsid flock -x "$L" bash -c 'echo held; sleep 7200' > "$L.out.$$" 2>&1 & )
  for i in $(seq 1 1200); do grep -q held "$L.out.$$" 2>/dev/null && break; sleep 1; done
  rm -f "$W"
  grep -q held "$L.out.$$" 2>/dev/null && echo "iolock: exclusive after ${i}s" || { echo "iolock: waited 20 min for the heavy jobs to finish" >&2; rm -f "$L.out.$$"; exit 1; }
  rm -f "$L.out.$$"
else
  for i in $(seq 1 900); do [ -e "$W" ] || break; sleep 1; done
  ( setsid flock -s "$L" sleep 7200 >/dev/null 2>&1 & )
  echo "iolock: shared"
fi
