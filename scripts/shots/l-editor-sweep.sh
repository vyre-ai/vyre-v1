#!/bin/bash
# runs each test file in the given dirs, one at a time, printing failures
for f in $(find "$@" -name "*.test.tsx" -o -name "*.test.ts" | grep -v "live\.\|perf" | sort); do
  out=$(TSX_TSCONFIG_PATH=$PWD/tsconfig.base.json timeout 100 node --import tsx --import ./scripts/shots/rn-alias.mjs --test $f 2>&1)
  if echo "$out" | grep -q "^ℹ fail 0"; then :; else echo "FAIL $f"; echo "$out" | grep -v "^ *at " | grep -E "✖|Error" | head -4; fi
done
echo SWEEP DONE
