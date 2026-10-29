#!/usr/bin/env bash
# Runs on a GitHub-hosted mac or windows runner after `tauri build` (ruling 4). Launches the built shell through
# apps/desktop/tests/shell.heavy.test.ts (shell starts, sidecar reachable, vyre:// link delivered) and takes a
# screenshot of the running window during the hold. VYRE_SHELL_RELAUNCH=1 repeats the installed-app smoke after a
# clean exit. Usage: run-shell.sh <app executable> <output dir>
set -u
APP="$1"; OUT="$2"; mkdir -p "$OUT"
shot() {
  if [ "$RUNNER_OS" = "Windows" ]; then
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \$bmp=New-Object System.Drawing.Bitmap \$b.Width,\$b.Height; \$g=[System.Drawing.Graphics]::FromImage(\$bmp); \$g.CopyFromScreen(\$b.Left,\$b.Top,0,0,\$bmp.Size); \$bmp.Save('$(cygpath -w "$1")')"
  else
    screencapture -x "$1"
  fi
}
export VYRE_SHELL_APP="$APP" VYRE_SHELL_HOLD_MS=25000 VYRE_SHELL_RELAUNCH="${VYRE_SHELL_RELAUNCH:-0}"
( sleep 14
  if [ "$RUNNER_OS" = "macOS" ]; then osascript -e 'tell application "System Events" to set frontmost of first process whose name is "vyre-desktop" to true' >/dev/null 2>&1 || true; sleep 2; fi
  shot "$OUT/$RUNNER_OS-shell.png"; sleep 3; shot "$OUT/$RUNNER_OS-shell-2.png" ) &
SHOT_PID=$!
trap 'kill "$SHOT_PID" 2>/dev/null || true; if [ "$RUNNER_OS" = "Windows" ]; then timeout 10 taskkill //F //IM vyre-desktop.exe >/dev/null 2>&1 || true; timeout 10 taskkill //F //IM vyred.exe >/dev/null 2>&1 || true; else pkill -f vyre-desktop >/dev/null 2>&1 || true; pkill -x vyred >/dev/null 2>&1 || true; fi' EXIT INT TERM
node --test --test-force-exit --test-timeout=60000 --test-reporter=spec apps/desktop/tests/shell.heavy.test.ts 2>&1 | tee "$OUT/shell-heavy.log"
RC=${PIPESTATUS[0]}
if [ "$RC" -ne 0 ]; then kill "$SHOT_PID" 2>/dev/null || true; fi
wait "$SHOT_PID" 2>/dev/null || true
exit "$RC"
