#!/usr/bin/env bash
# Contracts gate: regenerate and fail on drift, then typecheck manifests, generator and generated code.
# The generator tests and the generated contract tests run through scripts/test-run.mjs like every other test.
# Usage: tools/gen/check.sh   (Node 24; typescript and @types/node are installed under tools/gen only, never into a lockfile)
set -euo pipefail
cd "$(dirname "$0")/../.."

node --version
if [ ! -x tools/gen/node_modules/.bin/tsc ]; then
  (cd tools/gen && npm install --no-package-lock --no-audit --no-fund --loglevel=error)
fi

echo "== drift check =="
node tools/gen/src/cli.ts --check

echo "== typecheck =="
tools/gen/node_modules/.bin/tsc -p tools/gen/tsconfig.json
echo "contracts gate passed"
