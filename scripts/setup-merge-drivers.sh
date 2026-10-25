#!/usr/bin/env bash
# Run once per clone (and in CI jobs that merge): makes `merge=ours` in .gitattributes mean "keep our side" for generated/ and docs/frozen/snapshots. The regen bot rebuilds them afterwards.
set -euo pipefail
git config merge.ours.driver true
echo "merge=ours driver set for this clone"
