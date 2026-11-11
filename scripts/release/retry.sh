#!/usr/bin/env bash
# retry.sh <tries> <pause-seconds> <command> [args...]: run the command up to <tries> times, pausing pause*n seconds after try n, and exit with the last status.
# For a registry push that can drop its connection. It never makes a failing command pass: the last try's status is the exit status, and a command that fails every time fails the job.
set -u
tries="$1"; pause="$2"; shift 2
n=1
while true; do
  "$@" && exit 0
  rc=$?
  [ "$n" -ge "$tries" ] && { echo "retry: '$1' failed $n times, last status $rc"; exit "$rc"; }
  echo "retry: '$1' failed (status $rc), try $((n + 1)) of $tries in $((pause * n)) s"
  sleep "$((pause * n))"
  n=$((n + 1))
done
