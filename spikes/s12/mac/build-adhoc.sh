#!/bin/sh
# Ad-hoc sign a mac bundle that loads the S12 web build and starts vyred.
# Run from anywhere. Writes spikes/s12/proof/mac-adhoc-connected.png and codesign.txt.
# The second launch is the one that is captured, so OPFS can show a record written by the first launch.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
MAC="$ROOT/mac"
APP="$MAC/dist/Vyre.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$ROOT/proof"
swiftc -parse-as-library -framework AppKit -framework WebKit -o "$APP/Contents/MacOS/vyre" "$MAC/Shell.swift"
cp "$MAC/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/web/index.html" "$APP/Contents/Resources/web/index.html"
cp "$ROOT/src-tauri/binaries/vyred.py" "$APP/Contents/Resources/vyred"
chmod +x "$APP/Contents/MacOS/vyre"
codesign --force --deep --sign - "$APP"
codesign -dv --verbose=4 "$APP" >"$ROOT/proof/codesign.txt" 2>&1
# WebKit's data store follows HOME. A private HOME keeps OPFS inside a writable directory
# and the same across both launches. S12_PORT keeps the origin stable so the second launch reads the first.
HOME_DIR=$(mktemp -d /tmp/s12-home.XXXXXX)
export HOME="$HOME_DIR"
export S12_PORT=47211
# First launch writes the OPFS record. Second launch reads it back. Capture the second.
"$APP/Contents/MacOS/vyre" --proof "$ROOT/proof/mac-adhoc-first.png"
"$APP/Contents/MacOS/vyre" --proof "$ROOT/proof/mac-adhoc-connected.png"
rm -f "$ROOT/proof/mac-adhoc-first.png"
rm -rf "$HOME_DIR"
