#!/usr/bin/env bash
d=$(mktemp -d); cd $d; echo '{"type":"module"}' > package.json
npm install --no-audit --no-fund --ignore-scripts sqlite-wasm-cipher@2.2.4 playwright-core 2>&1 | tail -2
ls node_modules/sqlite-wasm-cipher node_modules/sqlite-wasm-cipher/dist | head -40
grep -o "opfs[A-Za-z-]*" -r node_modules/sqlite-wasm-cipher/dist/*.mjs 2>/dev/null | sort | uniq -c | sort -rn | head -8
cat node_modules/sqlite-wasm-cipher/package.json | head -40
timeout 200 npx playwright-core install chromium-headless-shell 2>&1 | tail -4
ls ~/.cache/ms-playwright 2>&1
