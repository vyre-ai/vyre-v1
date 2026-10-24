#!/usr/bin/env bash
# S12 desktop run: launch the Tauri shell, wait for the webview to report through vyred,
# kill it, launch again, expect the encrypted OPFS replica to read back, screenshot each time.
# usage: run-shell.sh <app executable> <output dir>
set -u
APP="$1"; OUT="$2"; mkdir -p "$OUT"
STATE="$OUT/state.log"
export VYRE_STATE_FILE="$STATE"

killall_app() {
  if [ "$RUNNER_OS" = "Windows" ]; then
    taskkill //F //IM vyre-desktop.exe >/dev/null 2>&1; taskkill //F //IM vyred.exe >/dev/null 2>&1
  else
    pkill -f vyre-desktop >/dev/null 2>&1; pkill -x vyred >/dev/null 2>&1
  fi
  sleep 3
}

shot() {
  if [ "$RUNNER_OS" = "Windows" ]; then
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \$bmp=New-Object System.Drawing.Bitmap \$b.Width,\$b.Height; \$g=[System.Drawing.Graphics]::FromImage(\$bmp); \$g.CopyFromScreen(\$b.Left,\$b.Top,0,0,\$bmp.Size); \$bmp.Save('$(cygpath -w "$1")')"
  else
    screencapture -x "$1"
  fi
}

run() { # $1 = label, $2 = expected replica state
  : > "$STATE"
  "$APP" >"$OUT/app-$1.log" 2>&1 &
  for _ in $(seq 1 25); do
    grep -q "replica=" "$STATE" 2>/dev/null && break
    sleep 2
  done
  sleep 4
  echo "diag health: $(curl -s -m 3 http://127.0.0.1:47211/health || echo none)"
  ps aux 2>/dev/null | grep -i vyre | grep -v grep | head -5
  shot "$OUT/$RUNNER_OS-$1.png"
  echo "run $1 state: $(cat "$STATE")"
  grep -q "sidecar=connected replica=$2" "$STATE"
  local rc=$?
  killall_app
  return $rc
}

killall_app
run first wrote || { echo "FAIL first launch"; tail -n 30 "$OUT/app-first.log"; exit 1; }
run second persisted || { echo "FAIL second launch"; tail -n 30 "$OUT/app-second.log"; exit 1; }
echo "S12 desktop OK on $RUNNER_OS"
