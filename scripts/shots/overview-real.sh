#!/bin/bash
# Exports the production app and runs the real-data Overview proof in a real browser. Run on the build box from the worktree: /root/export-slot.sh bash scripts/shots/overview-real.sh
set -e
H="$(node -e 'import("./scripts/lib/registry-hash.mjs").then((m) => console.log(m.registryHash()))')"
(cd apps/app && rm -rf dist && CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_VYRE_REGISTRY_HASH="$H" ../../node_modules/.bin/expo export --platform web --output-dir dist)
VYRE_APP_DIST="$PWD/apps/app/dist" VYRE_OVERVIEW_SHOTS="${VYRE_OVERVIEW_SHOTS:-/root/wt/l-tools-out/overview-real}" node --import tsx --import ./scripts/shots/rn-alias.mjs --test apps/app/tests/overview.real.live.test.ts
