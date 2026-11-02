#!/usr/bin/env bash
# The Mac install window as a person meets it. Runs on a macOS runner after the DMG is built. It fails unless the DMG really carries the layout: Tauri skips Finder on CI unless asked, and that DMG
# builds, verifies and installs while showing a plain window, so nothing else would notice. The screenshots are for looking at; a runner that refuses screen capture does not fail the check.
# Usage: dmg-window.sh <dmg> <output dir> <app x> <app y> <Applications x> <Applications y>
set -euo pipefail
DMG="$1"; OUT="$2"; AX="$3"; AY="$4"; BX="$5"; BY="$6"
VOL=/Volumes/Vyre
mkdir -p "$OUT"
[ ! -e "$VOL" ] || { echo "$VOL is already mounted"; exit 1; }
attached=0
finish() { if [ "$attached" = 1 ]; then hdiutil detach "$VOL" -force >/dev/null 2>&1 || true; fi; }
trap finish EXIT
hdiutil attach "$DMG" -noverify >/dev/null
attached=1

ls -la "$VOL" | tee "$OUT/dmg-listing.txt"
visible=$(ls "$VOL" | sort | tr '\n' ' ')
[ "$visible" = "Applications Vyre.app " ] || { echo "a person would see: $visible"; exit 1; }
[ "$(readlink "$VOL/Applications")" = "/Applications" ] || { echo "Applications is not a link to /Applications"; exit 1; }
[ -s "$VOL/.background/background.tiff" ] || { echo "no background in the DMG"; exit 1; }
[ -s "$VOL/.VolumeIcon.icns" ] || { echo "no volume icon in the DMG"; exit 1; }
[ -s "$VOL/.DS_Store" ] || { echo "no Finder layout in the DMG: the build skipped it"; exit 1; }
tiffutil -info "$VOL/.background/background.tiff" 2>&1 | tee "$OUT/dmg-background.txt" | grep -c 'Image Width' | grep -qx 2 || { echo "the background does not hold both densities"; exit 1; }

# .DS_Store keeps each icon's place as an Iloc record: name in UTF-16, the tag, a length of 16, then x and y.
python3 - "$VOL/.DS_Store" "$AX" "$AY" "$BX" "$BY" <<'PY'
import struct, sys
data = open(sys.argv[1], "rb").read()
want = {"Vyre.app": (int(sys.argv[2]), int(sys.argv[3])), "Applications": (int(sys.argv[4]), int(sys.argv[5]))}
for name, place in want.items():
    at = data.find(name.encode("utf-16-be") + b"Ilocblob")
    if at < 0:
        sys.exit(f"{name} has no saved place in .DS_Store")
    x, y = struct.unpack(">II", data[at + len(name) * 2 + 12:at + len(name) * 2 + 20])
    print(f"{name} at {x},{y}")
    if (x, y) != place:
        sys.exit(f"{name} is at {x},{y}, tauri.conf.json says {place[0]},{place[1]}")
if b"bwsp" not in data or b"icvp" not in data:
    sys.exit(".DS_Store has no window or icon view settings")
PY

# What it looks like, in each Finder appearance. Dark and light come from the viewer, not from the DMG.
look() {
  osascript -e "tell application \"System Events\" to tell appearance preferences to set dark mode to $1" >/dev/null 2>&1 || true
  sleep 2
  open "$VOL" || true
  osascript -e 'tell application "Finder" to activate' >/dev/null 2>&1 || true
  sleep 4
  screencapture -x "$OUT/dmg-window-$2.png" || true
  osascript -e 'tell application "Finder" to get bounds of front window' >"$OUT/dmg-bounds-$2.txt" 2>&1 || true
}
look false light
look true dark
# An open window can keep the labels it drew: a fresh Finder shows what a person who is already in dark mode gets.
killall Finder >/dev/null 2>&1 || true
sleep 3
look true dark-fresh
look false light-2
# Someone who shows hidden files must not find the window littered.
defaults write com.apple.finder AppleShowAllFiles -bool true || true
killall Finder >/dev/null 2>&1 || true
sleep 3
look false hidden-files
defaults delete com.apple.finder AppleShowAllFiles >/dev/null 2>&1 || true
killall Finder >/dev/null 2>&1 || true
echo "the DMG carries its window"
