#!/bin/sh
# install.sh (macOS): put Vyre Server on a Mac. This is what `curl -fsSL https://vyre.run/install-mac.sh | sh` runs. The same release, the same signed
# manifest check and the same folder layout as the Linux installer (scripts/install/linux/install.sh); what changes is the supervisor (a launchd agent
# instead of systemd units) and the machine checks (FileVault instead of LUKS, Docker Desktop or OrbStack instead of Docker Engine).
#
#   --dry-run          print every change, make none (read-only checks still run)
#   --yes              answer yes to every question
#   --channel C        stable (default), beta or nightly
#   --version V        install release V; the channel's manifest must name exactly that version
#   --domain NAME      serve this Space on your own domain (Caddy gets the certificate by ACME, ports 80 and 443 must reach this Mac)
#   --relay [URL]      serve through Vyre's relay instead (default https://relay.vyre.run); the Mac opens no public port
#   --data-dir DIR     where the Space's data lives (default $VYRE_DIR/data); must be on an encrypted volume (FileVault)
#   --uninstall        stop the server, remove the launchd agents and the vyre-server command; data and backups stay
#   --purge            with --uninstall: also delete the data and backups, after asking
#
# Environment: VYRE_DIR (default ~/.vyre/server), VYRE_UPDATE_URL (default https://vyre.run/server/), VYRE_CODE (the one-time setup code the Vyre app makes
# when a server is added; it is written only to $VYRE_DIR/vyre.env at mode 0600 and is never printed or taken as an argument).
#
# Run it as your own account, not with sudo: Docker Desktop and the launchd agent belong to the person who is logged in. In order, stopping at the first
# thing that is wrong:
#   1. checks the Mac: macOS, curl/tar/shasum/jq, OpenSSL 3 (the system one is LibreSSL and cannot check Ed25519; `brew install openssl@3 jq`),
#      10 GB free, and that the data directory is on a FileVault (encrypted) volume. There is no switch around this.
#   2. checks Docker Desktop, OrbStack or Colima is installed and running, with Compose 2.24 or newer. It does not install them.
#   3. downloads the channel's signed manifest and checks its Ed25519 signature against the Vyre release key in this script, then downloads the release
#      tarball and checks its sha256 against the manifest. Nothing from an unchecked file is ever run or read.
#   4. unpacks the release to $VYRE_DIR/releases/<version>, writes vyre.env (0600), compose.env and a compose override that keeps the data under the data
#      directory, writes two launchd agents in ~/Library/LaunchAgents (the server at login, a daily update at 04:00), pulls the images by digest and starts it.
#   5. waits for `vyre-server doctor` to be green and says what to do next.
#
# Everything lives inside functions and main is called on the last line, so a piped script is read whole before anything runs.
# VYRE_SOURCE_ONLY=1 loads the functions and runs nothing (tests).

set -eu

DRY=0
YES=0
UNINSTALL=0
PURGE=0
CHANNEL=stable
WANT=""
DOMAIN=""
RELAY=""
DATA_DIR_ARG=""
TMP=""
OSSL=""

DIR=${VYRE_DIR:-$HOME/.vyre/server}
UPDATE_URL=${VYRE_UPDATE_URL:-https://vyre.run/server/}
BIN_DIR=${VYRE_BIN_DIR:-$HOME/.local/bin}
AGENT_DIR=${VYRE_LAUNCHD_DIR:-$HOME/Library/LaunchAgents}
DEFAULT_RELAY=https://relay.vyre.run
MIN_FREE_MB=${VYRE_MIN_FREE_MB:-10240}
# The mark only our script writes into agents and the command, so we never replace or remove someone else's file.
MARK="Vyre Server, installed by install.sh"
LABEL_SERVER=ai.vyre.server
LABEL_UPDATE=ai.vyre.server-update

say() { printf '%s\n' "$*"; }
die() { printf 'vyre: %s\n' "$*" >&2; exit "${2:-1}"; }
cleanup() { [ -z "$TMP" ] || rm -rf "$TMP"; return 0; }

# show CMD...: the command as one line, for "would run:".
show() {
  line=""
  for a in "$@"; do
    case "$a" in
      *[!A-Za-z0-9_@%+=:,./-]*|"") line="$line '$a'" ;;
      *) line="$line $a" ;;
    esac
  done
  printf '%s' "${line# }"
}

# run CMD...: a change. In --dry-run it is only printed.
run() {
  if [ "$DRY" = 1 ]; then say "would run: $(show "$@")"; else "$@"; fi
}

ask() {
  [ "$YES" = 1 ] && return 0
  if ! (: </dev/tty) 2>/dev/null; then return 1; fi
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 1
  case "$answer" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

# ---- disk encryption (identical in vyre-server; the test compares the copies) -------------------------------------------------------
# BEGIN diskcheck
# disk_encrypted DIR: 0 when the volume that holds DIR is encrypted, 1 when it is not, 2 when it cannot be told.
# Linux: the mount that holds DIR (longest target in /proc/mounts) is ecryptfs, an encrypted ZFS dataset, or its block device stack has a
# dm-crypt layer (`lsblk -s` lists a "crypt" row). Anything else, including tmpfs and overlay, is not encrypted.
# macOS: `diskutil info` for the volume that holds DIR says FileVault: Yes (or Encrypted: Yes for an external volume).
disk_encrypted() {
  _d=$1
  _os=$(uname -s)
  [ "${VYRE_TEST_MODE:-0}" != 1 ] || [ -z "${VYRE_TEST_OS:-}" ] || _os=$VYRE_TEST_OS
  if [ "$_os" = Darwin ]; then
    _du=diskutil
    [ "${VYRE_TEST_MODE:-0}" != 1 ] || [ -z "${VYRE_TEST_DISKUTIL:-}" ] || _du=$VYRE_TEST_DISKUTIL
    _dev=$(df -P "$_d" 2>/dev/null | awk 'NR==2 {print $1}')
    [ -n "$_dev" ] || return 2
    _info=$("$_du" info "$_dev" 2>/dev/null || true)
    if printf '%s\n' "$_info" | grep -Eq '^ *(FileVault|Encrypted): +Yes'; then return 0; fi
    if printf '%s\n' "$_info" | grep -Eq '^ *(FileVault|Encrypted): +No'; then return 1; fi
    return 2
  fi
  _mounts=/proc/mounts
  _lsblk=lsblk
  if [ "${VYRE_TEST_MODE:-0}" = 1 ]; then _mounts=${VYRE_TEST_PROC_MOUNTS:-/proc/mounts}; [ -z "${VYRE_TEST_LSBLK:-}" ] || _lsblk=$VYRE_TEST_LSBLK; fi
  [ -r "$_mounts" ] || return 2
  _d=$(printf '%s' "$_d" | sed 's|/*$||'); [ -n "$_d" ] || _d=/
  _row=$(awk -v d="$_d" '
    { t = $2; gsub(/\\040/, " ", t) }
    (t == "/" || d == t || index(d, t "/") == 1) && length(t) >= best { best = length(t); line = $1 " " $3 }
    END { print line }' "$_mounts")
  [ -n "$_row" ] || return 2
  _src=${_row% *}
  _fs=${_row#* }
  case "$_fs" in
    ecryptfs) return 0 ;;
    zfs)
      _enc=$(zfs get -H -o value encryption "$_src" 2>/dev/null || true)
      case "$_enc" in ""|off|-) return 1 ;; *) return 0 ;; esac ;;
    tmpfs|overlay|ramfs|nfs|nfs4|cifs|9p|fuse*) return 1 ;;
  esac
  case "$_src" in /dev/*) ;; *) return 1 ;; esac
  _types=$("$_lsblk" -s -n -o TYPE "$_src" 2>/dev/null || true)
  [ -n "$_types" ] || return 2
  case "
$_types
" in *"
crypt
"*) return 0 ;; esac
  return 1
}
# END diskcheck
# ---- versions ----------------------------------------------------------------------------------------------------------------------
# BEGIN semver
# ver_cmp A B: prints -1, 0 or 1 (semver order: a prerelease sorts before its release; beta.10 is after beta.9). Returns 2 on a string that is not a version.
ver_cmp() {
  awk -v a="$1" -v b="$2" '
    function parse(v, o,   m, core, pre, n, i, parts) {
      if (v !~ /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/) return 0
      core = v; pre = ""
      if (index(v, "-")) { core = substr(v, 1, index(v, "-") - 1); pre = substr(v, index(v, "-") + 1) }
      split(core, parts, ".")
      o["maj"] = parts[1] + 0; o["min"] = parts[2] + 0; o["pat"] = parts[3] + 0; o["pre"] = pre
      return 1
    }
    function cmpnum(x, y) { return x < y ? -1 : (x > y ? 1 : 0) }
    function cmppre(p, q,   pp, qq, np, nq, i, x, y, isx, isy, c) {
      if (p == q) return 0
      if (p == "") return 1
      if (q == "") return -1
      np = split(p, pp, "."); nq = split(q, qq, ".")
      for (i = 1; i <= np && i <= nq; i++) {
        x = pp[i]; y = qq[i]; isx = (x ~ /^[0-9]+$/); isy = (y ~ /^[0-9]+$/)
        if (isx && isy) { c = cmpnum(x + 0, y + 0); if (c) return c }
        else if (isx) return -1
        else if (isy) return 1
        else if (x != y) return x < y ? -1 : 1
      }
      return cmpnum(np, nq)
    }
    BEGIN {
      if (!parse(a, A) || !parse(b, B)) exit 2
      c = cmpnum(A["maj"], B["maj"]); if (!c) c = cmpnum(A["min"], B["min"]); if (!c) c = cmpnum(A["pat"], B["pat"]); if (!c) c = cmppre(A["pre"], B["pre"])
      print c
    }'
}
# END semver
usage() { sed -n "2,14p" "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY=1 ;;
      --yes|-y) YES=1 ;;
      --uninstall) UNINSTALL=1 ;;
      --purge) PURGE=1 ;;
      --channel) shift; [ $# -gt 0 ] || die "--channel needs a value"; CHANNEL=$1 ;;
      --version) shift; [ $# -gt 0 ] || die "--version needs a value"; WANT=$1 ;;
      --domain) shift; [ $# -gt 0 ] || die "--domain needs a value"; DOMAIN=$1 ;;
      --relay) if [ $# -gt 1 ] && [ "${2#-}" = "$2" ]; then shift; RELAY=$1; else RELAY=$DEFAULT_RELAY; fi ;;
      --data-dir) shift; [ $# -gt 0 ] || die "--data-dir needs a value"; DATA_DIR_ARG=$1 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option $1 (see --help)" 2 ;;
    esac
    shift
  done
  case "$CHANNEL" in stable|beta|nightly) ;; *) die "--channel is stable, beta or nightly" 2 ;; esac
  if [ -n "$DOMAIN" ] && [ -n "$RELAY" ]; then die "--domain and --relay are two ways to reach this server; choose one" 2; fi
  case "$DOMAIN" in ""|*[!A-Za-z0-9.-]*) [ -z "$DOMAIN" ] || die "--domain must be a host name like vyre.example.com" 2 ;; esac
  DATA_DIR=${DATA_DIR_ARG:-${VYRE_DATA_DIR:-$DIR/data}}
  # These paths go into a property list and a compose file; a space or a markup character in them would break both.
  for p in "$DIR" "$DATA_DIR" "$BIN_DIR"; do
    case "$p" in *[!A-Za-z0-9_@%+=:,./~-]*) die "the path $p holds a space or a special character; choose a plain path (letters, digits, - _ . /)." 2 ;; esac
  done
}

# ---- the Mac ------------------------------------------------------------------------------------------------------------------------
is_user() {
  [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ "${VYRE_TEST_ROOT:-0}" != 1 ] && return 0
  [ "$(id -u)" != 0 ]
}

# find_openssl: sets OSSL to an OpenSSL 3 binary. macOS ships LibreSSL, which cannot verify a raw Ed25519 signature, so Homebrew's is looked for too.
find_openssl() {
  _more="/opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl /opt/homebrew/bin/openssl /usr/local/bin/openssl"
  [ "${VYRE_TEST_MODE:-0}" != 1 ] || [ "${VYRE_TEST_OPENSSL_ONLY:-0}" != 1 ] || _more=""
  for c in ${VYRE_OPENSSL:-} openssl $_more; do
    command -v "$c" >/dev/null 2>&1 || continue
    v=$("$c" version 2>/dev/null | awk '{print $1 " " $2}')
    case "$v" in "OpenSSL 3."*|"OpenSSL 4."*|"OpenSSL 5."*) OSSL=$(command -v "$c"); return 0 ;; esac
  done
  return 1
}

need_tools() {
  missing=""
  for t in curl tar shasum jq awk; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
  find_openssl || missing="$missing openssl@3"
  [ -n "$missing" ] || return 0
  say "Needs:$missing"
  die "Install them with Homebrew (brew install$missing), then run this installer again. Homebrew is at https://brew.sh."
}

check_space() {
  d=$1
  while [ ! -d "$d" ]; do d=$(dirname "$d"); done
  free_mb=$(df -Pm "$d" 2>/dev/null | awk 'NR==2 {print $4}')
  [ -n "$free_mb" ] || return 0
  [ "$free_mb" -ge "$MIN_FREE_MB" ] || die "$d has $free_mb MB free; Vyre Server needs at least $MIN_FREE_MB MB (images, the Space, backups)."
}

# The data directory must sit on an encrypted volume. Refuse, with the next step, when it does not.
check_encrypted() {
  d=$1
  probe=$d
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  disk_encrypted "$probe" && rc=0 || rc=$?
  case "$rc" in
    0) say "  ok  the data directory $d is on an encrypted volume" ;;
    *)
      printf 'vyre: the data directory %s is not on an encrypted volume%s.\n' "$d" "$([ "$rc" = 2 ] && printf ' that this installer can verify')" >&2
      cat >&2 <<EOT

Vyre keeps your Space's data, keys and backups here, so it will not install onto a plain disk.
Fix it one of these ways, then run the installer again:
  - turn on FileVault: System Settings > Privacy & Security > FileVault > Turn On
  - or choose a directory on an encrypted volume with --data-dir
EOT
      exit 3
      ;;
  esac
}

# ---- Docker -------------------------------------------------------------------------------------------------------------------------
compose_ok() {
  v=$(docker compose version --short 2>/dev/null | sed -n 's/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p')
  [ -n "$v" ] || return 1
  major=${v% *}
  minor=${v#* }
  [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 24 ]; }
}

need_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    if [ "$DRY" = 1 ]; then say "Docker is not installed. A real run would stop here and ask you to install Docker Desktop or OrbStack."; return 0; fi
    say "Vyre Server runs in Docker. Install Docker Desktop (https://www.docker.com/products/docker-desktop/) or OrbStack (brew install --cask orbstack), open it once, then run this installer again."
    exit 1
  fi
  if [ "$DRY" = 1 ] && ! docker info >/dev/null 2>&1; then say "Docker is installed but not running; a real run would stop here."; return 0; fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Open Docker Desktop (or OrbStack), wait until it says it is running, then run this installer again."
  compose_ok || die "This Mac needs Docker Compose 2.24 or newer (found $(docker compose version --short 2>/dev/null || echo none)). Update Docker Desktop and run this installer again."
}

# BEGIN release
# The Vyre release public key (Ed25519). The private half lives only in the `release` GitHub Environment. VYRE_RELEASE_KEY_PEM (a file) is for tests.
RELEASE_KEY_PEM='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKXSdujH7tO/gscXCJZmYCjB+Cv1sVlOfdgLNedMR7FU=
-----END PUBLIC KEY-----'

# ---- the signed release -------------------------------------------------------------------------------------------------------------
release_key_file() {
  if [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ -n "${VYRE_RELEASE_KEY_PEM:-}" ]; then printf '%s' "$VYRE_RELEASE_KEY_PEM"; return 0; fi
  printf '%s\n' "$RELEASE_KEY_PEM" >"$TMP/release-key.pem"
  printf '%s' "$TMP/release-key.pem"
}

# verify_manifest MANIFEST SIG_B64FILE: Ed25519 over "vyre-release-sums\n" followed by the exact manifest bytes.
verify_manifest() {
  key=$(release_key_file)
  tr -d ' \n\r' <"$2" | openssl base64 -d -A >"$TMP/sig.bin" 2>/dev/null || return 1
  [ "$(wc -c <"$TMP/sig.bin" | tr -d ' ')" = 64 ] || return 1
  { printf 'vyre-release-sums\n'; cat "$1"; } >"$TMP/signed.msg"
  "${OSSL:-openssl}" pkeyutl -verify -pubin -inkey "$key" -rawin -in "$TMP/signed.msg" -sigfile "$TMP/sig.bin" >/dev/null 2>&1
}

# sha256_of FILE: the hex digest (sha256sum on Linux, shasum on macOS).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

fetch() { curl -fsSL --retry 3 --retry-delay 2 --max-time "${3:-120}" "$1" -o "$2"; }

# fetch_release: the channel's manifest and the release tarball, both checked. Sets REL_VERSION and REL_TARBALL (a checked file).
fetch_release() {
  base=${UPDATE_URL%/}
  say "  Fetching the $CHANNEL release manifest from $base/"
  fetch "$base/$CHANNEL.json" "$TMP/manifest.json" 30 || die "could not reach $base/$CHANNEL.json; check this machine's network and run the installer again."
  fetch "$base/$CHANNEL.json.sig" "$TMP/manifest.sig" 30 || die "could not fetch the manifest's signature; nothing was installed."
  verify_manifest "$TMP/manifest.json" "$TMP/manifest.sig" || die "the release signature does not match the Vyre release key in this installer; nothing was installed."
  say "  ok  the release signature verifies"
  [ "$(jq -r '.v // empty' "$TMP/manifest.json")" = 1 ] || die "the release manifest is not a version this installer reads; nothing was installed."
  [ "$(jq -r '.channel // empty' "$TMP/manifest.json")" = "$CHANNEL" ] || die "the manifest is for another channel than $CHANNEL; nothing was installed."
  REL_VERSION=$(jq -r '.server.version // empty' "$TMP/manifest.json")
  url=$(jq -r '.server.tarball // empty' "$TMP/manifest.json")
  sum=$(jq -r '.server.sha256 // empty' "$TMP/manifest.json")
  ver_cmp "$REL_VERSION" "$REL_VERSION" >/dev/null 2>&1 || die "the manifest has no server version; nothing was installed."
  case "$sum" in *[!0-9a-f]*|"") die "the manifest does not give the artifact's sha256; nothing was installed." ;; esac
  [ "${#sum}" = 64 ] || die "the manifest does not give the artifact's sha256; nothing was installed."
  if [ -n "$WANT" ] && [ "$WANT" != latest ] && [ "$WANT" != "$REL_VERSION" ]; then
    die "the $CHANNEL channel offers $REL_VERSION, not $WANT; nothing was installed."
  fi
  if [ -n "${WANT_SHA256:-}" ] && [ "$WANT_SHA256" != "$sum" ]; then
    die "the reviewed artifact changed on the $CHANNEL channel; check the release again before installing. Nothing was installed."
  fi
  case "$url" in http://*|https://*) ;; "") die "the manifest names no artifact; nothing was installed." ;; *) url="$base/$url" ;; esac
  say "  Downloading Vyre Server $REL_VERSION"
  fetch "$url" "$TMP/release.tgz" 900 || die "could not download $url; nothing was installed."
  got=$(sha256_of "$TMP/release.tgz")
  [ "$got" = "$sum" ] || die "the download does not match the signed release (wanted $sum, got $got); nothing was installed."
  say "  ok  the download matches the signed release"
  REL_TARBALL=$TMP/release.tgz
}

# unpack_release: into $DIR/releases/<version>, refusing any path that would leave it and any release without the files the server needs.
unpack_release() {
  rel=$DIR/releases/$REL_VERSION
  if [ -d "$rel" ] && [ -f "$rel/.complete" ]; then say "  Release $REL_VERSION is already unpacked"; return 0; fi
  if [ "$DRY" = 1 ]; then say "would unpack $REL_VERSION to $rel"; return 0; fi
  tar -tzf "$REL_TARBALL" | awk '{ if ($0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/) bad = 1 } END { exit bad }' || die "the release holds a path outside its folder; nothing was installed."
  tar -tvzf "$REL_TARBALL" | awk '$1 ~ /^[lh]/ { bad = 1 } END { exit bad }' || die "the release holds a link; nothing was installed."
  rm -rf "$rel.part"
  mkdir -p "$rel.part"
  tar -xzf "$REL_TARBALL" -C "$rel.part" --strip-components=1 --no-same-owner
  for f in VERSION compose.server.yml Caddyfile images.lock bin/vyre-server units/vyre-server.service units/vyre-server-update.service units/vyre-server-update.timer; do
    [ -f "$rel.part/$f" ] || { rm -rf "$rel.part"; die "the release has no $f; nothing was installed."; }
  done
  [ "$(cat "$rel.part/VERSION")" = "$REL_VERSION" ] || { rm -rf "$rel.part"; die "the release's VERSION file does not match its manifest; nothing was installed."; }
  chmod 0755 "$rel.part/bin/vyre-server"
  : >"$rel.part/.complete"
  rm -rf "$rel"
  mv "$rel.part" "$rel"
}
# END release

# ---- configuration, agents, start --------------------------------------------------------------------------------------------------
# lock_get KEY: a value from the release's images.lock.
lock_get() { sed -n "s/^$1=\\(.*\\)\$/\\1/p" "$DIR/releases/$REL_VERSION/images.lock" 2>/dev/null | head -n 1; }

# space_id: the Space's id. An earlier install's compose.env wins, then VYRE_SPACE, else a new spc_ id. A re-run keeps it.
space_id() {
  _s=$(sed -n 's/^VYRE_SPACE=\(.*\)$/\1/p' "$DIR/compose.env" 2>/dev/null | head -n 1)
  [ -n "$_s" ] || _s=${VYRE_SPACE:-}
  [ -n "$_s" ] || _s=spc_$("${OSSL:-openssl}" rand -hex 12)
  printf '%s' "$_s"
}

write_config() {
  if [ "$DRY" = 1 ]; then say "would write $DIR/vyre.env (0600), $DIR/compose.env and $DIR/compose.override.yml, and create $DATA_DIR"; return 0; fi
  mkdir -p "$DIR" "$DATA_DIR/space" "$DATA_DIR/work" "$DATA_DIR/caddy" "$DATA_DIR/caddy-config" "$DIR/backups" "$DIR/state"
  chmod 0700 "$DATA_DIR" "$DIR/backups"
  # Docker Desktop and OrbStack share the folder with the container under the person's own account, so the folders keep this person as owner.
  # vyre.env keeps what the person set; a re-run never overwrites it.
  if [ ! -f "$DIR/vyre.env" ]; then
    ( umask 077; : >"$DIR/vyre.env" )
    chmod 0600 "$DIR/vyre.env"
    [ -z "${VYRE_CODE:-}" ] || printf 'VYRE_SETUP_CODE=%s\n' "$VYRE_CODE" >>"$DIR/vyre.env"
  fi
  # compose.env: what the compose file reads. Rewritten each install from the release and the choices made here.
  {
    printf 'VYRE_IMAGE=%s\n' "$(lock_get VYRE_IMAGE)"
    printf 'VYRE_PORT=8420\n'
    printf 'VYRE_SPACE=%s\n' "$(space_id)"
    [ -z "$DOMAIN" ] || printf 'VYRE_ADDRESS=%s\n' "$DOMAIN"
    [ -z "$RELAY" ] || printf 'VYRE_RELAY_URL=%s\n' "$RELAY"
  } >"$DIR/compose.env.new"
  # A re-run keeps the address and relay chosen the first time unless a flag changes them.
  if [ -f "$DIR/compose.env" ]; then
    for k in VYRE_ADDRESS VYRE_RELAY_URL; do
      if ! grep -q "^$k=" "$DIR/compose.env.new" && grep -q "^$k=" "$DIR/compose.env" && { [ -z "$DOMAIN" ] && [ -z "$RELAY" ]; }; then grep "^$k=" "$DIR/compose.env" >>"$DIR/compose.env.new"; fi
    done
  fi
  mv "$DIR/compose.env.new" "$DIR/compose.env"
  printf '%s\n' "$CHANNEL" >"$DIR/channel"
  printf '%s\n' "${UPDATE_URL%/}/" >"$DIR/update-url"
  cat >"$DIR/compose.override.yml" <<EOT
# $MARK. The data lives under $DATA_DIR, on the encrypted volume the installer checked.
volumes:
  vyre-data:
    driver: local
    driver_opts: { type: none, o: bind, device: $DATA_DIR/space }
  vyre-work:
    driver: local
    driver_opts: { type: none, o: bind, device: $DATA_DIR/work }
  caddy-data:
    driver: local
    driver_opts: { type: none, o: bind, device: $DATA_DIR/caddy }
  caddy-config:
    driver: local
    driver_opts: { type: none, o: bind, device: $DATA_DIR/caddy-config }
EOT
  printf '%s\n' "$DATA_DIR" >"$DIR/data-dir"
}

link_current() {
  [ "$DRY" = 1 ] && { say "would point $DIR/current at releases/$REL_VERSION"; return 0; }
  if [ -L "$DIR/current" ]; then
    prev=$(readlink "$DIR/current")
    [ "$prev" = "releases/$REL_VERSION" ] || printf '%s\n' "$prev" >"$DIR/previous"
  fi
  ln -sfn "releases/$REL_VERSION" "$DIR/current.new"
  mv -Tf "$DIR/current.new" "$DIR/current" 2>/dev/null || { rm -f "$DIR/current"; mv "$DIR/current.new" "$DIR/current"; }
  ln -sfn "$DIR/vyre.env" "$DIR/releases/$REL_VERSION/vyre.env"
  install -d "$BIN_DIR"
  # The command is a small wrapper that runs the current release's own script, so an update changes it too. It names this install's folder and
  # Docker's usual places, because a launchd agent starts with almost no PATH.
  cat >"$BIN_DIR/vyre-server.new" <<EOT
#!/bin/sh
# $MARK
VYRE_DIR="$DIR"
export VYRE_DIR
PATH="\$PATH:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:\$HOME/.orbstack/bin"
export PATH
exec "$DIR/current/bin/vyre-server" "\$@"
EOT
  chmod 0755 "$BIN_DIR/vyre-server.new"
  mv "$BIN_DIR/vyre-server.new" "$BIN_DIR/vyre-server"
  printf 'VYRE_DIR=%s\n' "$DIR" >"$DIR/state/install.env"
}

# plist LABEL ARG... : one launchd property list on stdout. The server agent runs `start` at login and again every 30 s until it succeeds (Docker may
# still be opening); the update agent is a calendar job.
plist() {
  _label=$1; shift
  _cmd=$1; shift
  cat <<EOT
<?xml version="1.0" encoding="UTF-8"?>
<!-- $MARK -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN_DIR/vyre-server</string>
    <string>$_cmd</string>
EOT
  for a in "$@"; do printf '    <string>%s</string>\n' "$a"; done
  printf '  </array>\n'
  if [ "$_label" = "$LABEL_SERVER" ]; then
    cat <<EOT
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
EOT
  else
    cat <<EOT
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>Nice</key><integer>10</integer>
EOT
  fi
  cat <<EOT
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StandardOutPath</key><string>$DIR/state/$_label.log</string>
  <key>StandardErrorPath</key><string>$DIR/state/$_label.log</string>
</dict>
</plist>
EOT
}

# launchd_domain: the login session the agents live in.
launchd_domain() { printf 'gui/%s' "$(id -u)"; }

write_agents() {
  if [ "$DRY" = 1 ]; then say "would write $AGENT_DIR/$LABEL_SERVER.plist and $LABEL_UPDATE.plist and load them with launchctl"; return 0; fi
  install -d "$AGENT_DIR"
  plist "$LABEL_SERVER" start >"$AGENT_DIR/$LABEL_SERVER.plist.new"
  plist "$LABEL_UPDATE" update --yes >"$AGENT_DIR/$LABEL_UPDATE.plist.new"
  for l in "$LABEL_SERVER" "$LABEL_UPDATE"; do
    chmod 0644 "$AGENT_DIR/$l.plist.new"
    mv "$AGENT_DIR/$l.plist.new" "$AGENT_DIR/$l.plist"
  done
  if command -v launchctl >/dev/null 2>&1 && [ "${VYRE_TEST_MODE:-0}" != 1 ]; then
    for l in "$LABEL_SERVER" "$LABEL_UPDATE"; do
      launchctl bootout "$(launchd_domain)/$l" >/dev/null 2>&1 || true
      launchctl enable "$(launchd_domain)/$l" >/dev/null 2>&1 || true
    done
    # Only the update agent is loaded now; the server is started by start_stack, and the agent takes over at the next login.
    launchctl bootstrap "$(launchd_domain)" "$AGENT_DIR/$LABEL_UPDATE.plist" >/dev/null 2>&1 || true
  fi
}

pull_images() {
  for k in VYRE_IMAGE VYRE_AGENT_IMAGE VYRE_SANDBOX_IMAGE; do
    ref=$(lock_get "$k")
    [ -n "$ref" ] || continue
    case "$ref" in *@sha256:*) ;; *) die "the release names $k without a digest ($ref); nothing was started." ;; esac
    if [ "$DRY" = 1 ]; then say "would run: docker pull $ref"; continue; fi
    say "  Pulling $ref"
    docker pull -q "$ref" >/dev/null || die "could not pull $ref; check this Mac's network (and the registry) and run the installer again."
  done
}

start_stack() {
  if [ "$DRY" = 1 ]; then say "would start the server: vyre-server start (docker compose up -d), then load the $LABEL_SERVER agent"; return 0; fi
  "$DIR/current/bin/vyre-server" start || die "the server did not start; read: vyre-server logs"
  if command -v launchctl >/dev/null 2>&1 && [ "${VYRE_TEST_MODE:-0}" != 1 ]; then
    launchctl bootstrap "$(launchd_domain)" "$AGENT_DIR/$LABEL_SERVER.plist" >/dev/null 2>&1 || true
  fi
}

wait_green() {
  [ "$DRY" = 1 ] && return 0
  say "  Waiting for the server to be healthy (up to ${VYRE_UP_WAIT:-180} s)"
  n=0
  while [ "$n" -lt "${VYRE_UP_WAIT:-180}" ]; do
    if "$DIR/current/bin/vyre-server" doctor --quiet >/dev/null 2>&1; then say "  ok  vyre-server doctor is green"; return 0; fi
    n=$((n + 3))
    sleep 3
  done
  "$DIR/current/bin/vyre-server" doctor || true
  die "the server did not become healthy. Read: vyre-server logs"
}

finish() {
  say ""
  if [ "$DRY" = 1 ]; then
    say "That is the whole plan. Nothing on this Mac changed. Run it again without --dry-run when you are ready."
  else
    say "Vyre Server $REL_VERSION is running."
    if [ -n "$DOMAIN" ]; then say "Your Space will answer at https://$DOMAIN once its certificate is issued (ports 80 and 443 must reach this Mac)."
    elif [ -n "$RELAY" ]; then say "It connects outward to $RELAY; no public port is open on this Mac."
    else say "Choose how people reach it: run the installer again with --domain NAME or --relay."
    fi
    case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "Add $BIN_DIR to your PATH to use the vyre-server command (for example: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc)." ;; esac
    say "The server starts when you log in, and Docker has to be open. A Mac that goes to sleep stops serving: in System Settings > Battery (or Energy), keep it awake when plugged in."
    say "Go back to the Vyre app to finish setting up this server."
    say "Check it any time with: vyre-server doctor"
  fi
  say ""
}

uninstall() {
  [ -d "$DIR" ] || die "nothing is installed at $DIR."
  if [ "$PURGE" = 1 ] && ! ask "Delete the Space's data and every backup under $DIR? This cannot be undone."; then die "not purged."; fi
  for l in "$LABEL_SERVER" "$LABEL_UPDATE"; do
    if command -v launchctl >/dev/null 2>&1 && [ "${VYRE_TEST_MODE:-0}" != 1 ]; then run launchctl bootout "$(launchd_domain)/$l" || true; fi
  done
  if [ -x "$DIR/current/bin/vyre-server" ]; then run "$BIN_DIR/vyre-server" stop || true; fi
  # Remove the containers while the release's compose file still exists; --purge also drops the volumes.
  if [ -f "$DIR/current/compose.server.yml" ] && [ -f "$DIR/compose.env" ] && command -v docker >/dev/null 2>&1; then
    down_flags="--remove-orphans"; [ "$PURGE" != 1 ] || down_flags="-v --remove-orphans"
    # shellcheck disable=SC2086
    run docker compose --project-directory "$DIR/current" --env-file "$DIR/compose.env" -f "$DIR/current/compose.server.yml" -f "$DIR/compose.override.yml" down $down_flags || true
  fi
  if [ "$PURGE" = 1 ] && [ "$DRY" != 1 ] && command -v docker >/dev/null 2>&1; then
    proj=${COMPOSE_PROJECT_NAME:-vyre-server}
    for c in $(docker ps -aq --filter "label=com.docker.compose.project=$proj" 2>/dev/null); do docker rm -f "$c" >/dev/null 2>&1 || true; done
    for v in $(docker volume ls -q --filter "label=com.docker.compose.project=$proj" 2>/dev/null); do docker volume rm -f "$v" >/dev/null 2>&1 || true; done
  fi
  for l in "$LABEL_SERVER" "$LABEL_UPDATE"; do
    if [ -f "$AGENT_DIR/$l.plist" ] && grep -q "$MARK" "$AGENT_DIR/$l.plist"; then run rm -f "$AGENT_DIR/$l.plist"; fi
  done
  if [ -f "$BIN_DIR/vyre-server" ] && grep -q "$MARK" "$BIN_DIR/vyre-server"; then run rm -f "$BIN_DIR/vyre-server"; fi
  if [ "$PURGE" = 1 ]; then
    d=$(cat "$DIR/data-dir" 2>/dev/null || printf '%s' "$DATA_DIR")
    run rm -rf "$d" "$DIR"
    say "Removed Vyre Server and its data."
  else
    run rm -rf "$DIR/releases" "$DIR/current" "$DIR/previous"
    say "Removed Vyre Server. The Space's data and backups stay in $(cat "$DIR/data-dir" 2>/dev/null || printf '%s' "$DATA_DIR") and $DIR/backups."
  fi
}

main() {
  umask 022
  parse_args "$@"
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/vyre-install.XXXXXX")
  trap cleanup EXIT
  case "$(uname -s)" in Darwin) ;; *) [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "this installer is for a Mac; on Linux use the Linux installer (https://vyre.run/install.sh)." ;; esac
  case "$(uname -m)" in x86_64|amd64|aarch64|arm64) ;; *) die "Vyre Server runs on Intel and Apple silicon Macs; this machine is $(uname -m)." ;; esac
  is_user || die "run this as your own account, not with sudo: Docker Desktop and the launchd agent belong to the person who is logged in."
  if [ "$UNINSTALL" = 1 ]; then uninstall; return 0; fi
  say "Installing Vyre Server on this Mac. It checks the download against Vyre's signature before installing anything."
  need_tools
  check_encrypted "$DATA_DIR"
  check_space "$DATA_DIR"
  need_docker
  fetch_release
  unpack_release
  write_config
  link_current
  write_agents
  pull_images
  start_stack
  wait_green
  finish
}

if [ "${VYRE_SOURCE_ONLY:-0}" != 1 ]; then main "$@"; fi
