#!/usr/bin/env bash
# Removes agent-computer containers and volumes (vyre-comp*) that are older than MAX_AGE_HOURS (default 2). Each CI host runs several jobs at once, so a job must never delete a computer that a running job of the same host just made.
set -u
cutoff=$(( $(date +%s) - ${MAX_AGE_HOURS:-2} * 3600 ))
older() { local t; t="$(date -d "$1" +%s 2>/dev/null)" || return 1; [ "$t" -lt "$cutoff" ]; }
for n in $(docker ps -aq --filter name=vyre-comp); do
  c="$(docker inspect --format '{{.Created}}' "$n" 2>/dev/null)" || continue
  older "$c" && docker rm -f "$n" >/dev/null && echo "removed old computer $n"
done
for v in $(docker volume ls -q --filter name=vyre-comp); do
  c="$(docker volume inspect --format '{{.CreatedAt}}' "$v" 2>/dev/null)" || continue
  older "$c" && docker volume rm -f "$v" >/dev/null && echo "removed old volume $v"
done
exit 0
