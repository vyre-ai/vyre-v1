#!/usr/bin/env bash
# Runs every sync spike file (one node process each) and prints the METRIC lines. Run on CI via the spike workflow.
cd "$(dirname "$0")"
node -v
npm install --no-audit --no-fund --no-package-lock 2>&1 | tail -3
fail=0
for f in ${@:-s1.oplog s2.revocation s3.offline s4.yjs s5.e2e s6.devicestore}; do
  echo "=== $f"
  node --test --test-timeout=900000 "$f.spike.mjs" 2>&1 | tee "/tmp/$f.log" | grep -v "^#\|^TAP" | head -150
  [ "${PIPESTATUS[0]}" = "0" ] || { echo "FILE FAILED: $f"; fail=1; }
done
echo "=== METRICS"; grep -h "METRIC" /tmp/*.log 2>/dev/null | sort -u
exit $fail
