#!/bin/sh
# install.real.test.sh: the macOS installer on a real Mac's own tools (BSD tar, shasum, diskutil, plutil, LibreSSL next to a Homebrew OpenSSL 3), with no
# Docker and no launchd changes. CI runs it on a hosted macOS runner (.github/workflows/desktop.yml); never run it on a Mac you rely on for a server.
# What it proves that the unit tests (install.test.ts, which run on Linux too) cannot: diskutil's real output is understood, a real release tarball unpacks
# with BSD tar, a signed feed over file:// is fetched and checked with shasum, and the launchd property lists pass `plutil -lint`.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL=$HERE/install.sh
W=$(mktemp -d "${TMPDIR:-/tmp}/vyre-mac-real.XXXXXX")
trap 'rm -rf "$W"' EXIT
fail() { echo "not ok - $1" >&2; exit 1; }
ok() { echo "ok - $1"; }
[ "$(uname -s)" = Darwin ] || fail "this test is for macOS"

# Homebrew's OpenSSL 3 makes the key and the signature the way the release job does; the system openssl (LibreSSL) must be skipped by the installer.
OSSL3=""
for c in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do [ -x "$c" ] && OSSL3=$c && break; done
[ -n "$OSSL3" ] || { command -v brew >/dev/null 2>&1 && brew install openssl@3 >/dev/null 2>&1 && OSSL3=$(brew --prefix openssl@3)/bin/openssl; }
[ -x "$OSSL3" ] || fail "no OpenSSL 3 on this runner"

# 1. diskutil's real answer is one the check understands (0 encrypted, 1 not); 2 would mean the parser cannot read this macOS.
rc=0; VYRE_SOURCE_ONLY=1 sh -c ". '$INSTALL'; disk_encrypted '$W'" || rc=$?
case "$rc" in 0|1) ok "disk_encrypted reads diskutil on this macOS (answer $rc)" ;; *) diskutil info "$(df -P "$W" | awk 'NR==2 {print $1}')" | head -30; fail "disk_encrypted could not tell (answer $rc)" ;; esac

# 2. find_openssl skips LibreSSL and finds an OpenSSL 3.
found=$(VYRE_SOURCE_ONLY=1 HOME=$W sh -c ". '$INSTALL'; find_openssl && echo \"\$OSSL\"") || fail "find_openssl found no OpenSSL 3"
"$found" version | grep -Eq '^OpenSSL [345]' || fail "find_openssl returned $found"
ok "find_openssl chose $found over $(/usr/bin/openssl version | cut -d' ' -f1-2)"

# 3. a signed feed over file:// with a real tarball in the release layout.
REL=$W/pack/vyre-1.0.0
mkdir -p "$REL/bin" "$REL/units" "$W/feed"
echo 1.0.0 >"$REL/VERSION"
for f in compose.server.yml Caddyfile bin/vyre-server units/vyre-server.service units/vyre-server-update.service units/vyre-server-update.timer; do echo x >"$REL/$f"; done
echo "VYRE_IMAGE=ghcr.io/vyre-ai/vyred@sha256:$(printf 'b%.0s' $(seq 64))" >"$REL/images.lock"
tar -czf "$W/feed/vyre.tgz" -C "$W/pack" vyre-1.0.0
SUM=$(shasum -a 256 "$W/feed/vyre.tgz" | awk '{print $1}')
printf '{"v":1,"channel":"stable","server":{"version":"1.0.0","tarball":"vyre.tgz","sha256":"%s"}}' "$SUM" >"$W/feed/stable.json"
"$OSSL3" genpkey -algorithm ed25519 -out "$W/k.pem" 2>/dev/null
"$OSSL3" pkey -in "$W/k.pem" -pubout -out "$W/k.pub" 2>/dev/null
{ printf 'vyre-release-sums\n'; cat "$W/feed/stable.json"; } >"$W/msg"
"$OSSL3" pkeyutl -sign -inkey "$W/k.pem" -rawin -in "$W/msg" -out "$W/raw"
base64 <"$W/raw" | tr -d '\n' >"$W/feed/stable.json.sig"

D=$W/vyre
out=$(HOME=$W VYRE_TEST_MODE=1 VYRE_RELEASE_KEY_PEM="$W/k.pub" VYRE_OPENSSL="$OSSL3" VYRE_SOURCE_ONLY=1 sh -c "
  . '$INSTALL'
  DIR='$D'; DATA_DIR='$D/data'; BIN_DIR='$W/bin'; AGENT_DIR='$W/agents'; UPDATE_URL='file://$W/feed/'; CHANNEL=stable; DRY=0
  find_openssl; TMP=\$(mktemp -d)
  fetch_release; unpack_release; write_config; link_current; write_agents
  echo \"installed \$REL_VERSION\"") || fail "fetch, unpack, configure"
echo "$out" | grep -q 'installed 1.0.0' || fail "install did not finish: $out"
[ -f "$D/releases/1.0.0/.complete" ] && [ -L "$D/current" ] || fail "release not in place"
ok "a signed release was fetched over file://, checked with shasum, unpacked by BSD tar and linked"

# 4. a release whose tarball changed after signing is refused.
echo tamper >>"$W/feed/vyre.tgz"
if HOME=$W VYRE_TEST_MODE=1 VYRE_RELEASE_KEY_PEM="$W/k.pub" VYRE_OPENSSL="$OSSL3" VYRE_SOURCE_ONLY=1 sh -c ". '$INSTALL'; DIR='$W/other'; UPDATE_URL='file://$W/feed/'; CHANNEL=stable; find_openssl; TMP=\$(mktemp -d); fetch_release" >/dev/null 2>&1; then fail "a changed tarball was accepted"; fi
ok "a tarball that does not match the signed manifest is refused"

# 5. the launchd property lists are valid, marked, and point at the wrapper.
for l in ai.vyre.server ai.vyre.server-update; do
  plutil -lint "$W/agents/$l.plist" >/dev/null || fail "$l.plist fails plutil -lint"
  grep -q 'Vyre Server, installed by install.sh' "$W/agents/$l.plist" || fail "$l.plist has no mark"
done
[ "$(plutil -extract RunAtLoad raw "$W/agents/ai.vyre.server.plist")" = true ] || fail "the server agent does not run at load"
ok "both launchd agents pass plutil -lint"

# 6. the wrapper command runs the release's own script.
printf '#!/bin/sh\necho "ran $VYRE_DIR $*"\n' >"$D/releases/1.0.0/bin/vyre-server"; chmod +x "$D/releases/1.0.0/bin/vyre-server"
[ "$("$W/bin/vyre-server" doctor)" = "ran $D doctor" ] || fail "the wrapper does not run the current release"
ok "the vyre-server command runs the current release with this install's folder"
echo "# pass 6 fail 0"
