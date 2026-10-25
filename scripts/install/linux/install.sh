#!/bin/sh
# install.sh: put Vyre Server on a Linux machine. This is what `curl -fsSL https://vyre.run/install.sh | sh` runs, and
# what `vyre-server` is installed by. Spec 3.13 (Install, Add a server), ARCH 7.13 (installer), b13 (server channel).
#
#   --dry-run          print every change, make none (read-only checks still run)
#   --yes              answer yes to every question (Docker's apt repository, a missing tool)
#   --channel C        stable (default), beta or nightly
#   --version V        install release V; the channel's manifest must name exactly that version
#   --domain NAME      serve this Space on your own domain (Caddy gets the certificate by ACME, ports 80 and 443 must reach this machine)
#   --relay [URL]      serve through Vyre's relay instead (default https://relay.vyre.run); the machine opens no public port
#   --data-dir DIR     where the Space's data lives (default $VYRE_DIR/data); must be on an encrypted volume
#   --uninstall        stop the server, remove the units and /usr/local/bin/vyre-server; data and backups stay
#   --purge            with --uninstall: also delete the data and backups, after asking
#
# Environment: VYRE_DIR (default /srv/vyre), VYRE_UPDATE_URL (default https://vyre.run/server/), VYRE_CODE (the one-time setup
# code the Vyre app makes when a server is added, for the install line `curl -fsSL https://vyre.run/install.sh | VYRE_CODE=... sh`;
# it is written only to $VYRE_DIR/vyre.env at mode 0600 and is never printed or taken as an argument).
#
# What it does, in order, and stops at the first thing that is wrong:
#   1. checks the machine: Linux, root, curl/tar/sha256sum/openssl/jq, 10 GB free, and that the data directory sits on an ENCRYPTED volume
#      (LUKS or dm-crypt, an encrypted ZFS dataset, or ecryptfs). Without one it refuses and says how to fix it. There is no switch around this.
#   2. installs Docker Engine and the Compose plugin from Docker's signed apt repository on Debian and Ubuntu when they are missing.
#   3. downloads the channel's signed manifest and checks its Ed25519 signature against the Vyre release key in this script (the signature covers
#      "vyre-release-sums\n" and the exact manifest bytes, the same scheme the server's own updater checks), then downloads the release tarball and
#      checks its sha256 against the manifest. A bad signature or hash stops everything; nothing from an unchecked file is ever run or read.
#   4. unpacks the release to $VYRE_DIR/releases/<version>, writes vyre.env (0600), compose.env and a compose override that keeps the data
#      under the data directory, writes the systemd units (the server, a daily update timer), pulls the images by digest (the server and the
#      agent computer) and starts it.
#   5. waits for `vyre-server doctor` to be green and says what to do next.
#
# A release tarball unpacks to one folder holding: VERSION, compose.server.yml, Caddyfile, images.lock (KEY=value lines VYRE_IMAGE=...@sha256:,
# VYRE_AGENT_IMAGE=...@sha256:, VYRE_SANDBOX_IMAGE=...@sha256:), bin/vyre-server and units/ (the three systemd unit files).
#
# Everything lives inside functions and main is called on the last line, so the shell has read the whole script before anything runs: piped
# from curl, a command that reads stdin would otherwise eat the rest of the script. VYRE_SOURCE_ONLY=1 loads the functions and runs nothing (tests).

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

DIR=${VYRE_DIR:-/srv/vyre}
UPDATE_URL=${VYRE_UPDATE_URL:-https://vyre.run/server/}
BIN_DIR=${VYRE_BIN_DIR:-/usr/local/bin}
UNIT_DIR=${VYRE_SYSTEMD_DIR:-/etc/systemd/system}
DEFAULT_RELAY=https://relay.vyre.run
MIN_FREE_MB=${VYRE_MIN_FREE_MB:-10240}
# The mark only our script writes into units and the command, so we never replace or remove someone else's file.
MARK="Vyre Server, installed by install.sh"

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

# ---- disk encryption (identical in vyre-server; the test compares the two copies) -------------------------------------------------
# BEGIN diskcheck
# disk_encrypted DIR: 0 when the volume that holds DIR is encrypted, 1 when it is not, 2 when it cannot be told.
# Linux: the mount that holds DIR (longest target in /proc/mounts) is ecryptfs, an encrypted ZFS dataset, or its block device stack has a
# dm-crypt layer (`lsblk -s` lists a "crypt" row). Anything else, including tmpfs and overlay, is not encrypted.
disk_encrypted() {
  _d=$1
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

usage() { sed -n '2,19p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

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
}

# ---- the machine --------------------------------------------------------------------------------------------------------------------
is_root() {
  [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ "${VYRE_TEST_NONROOT:-0}" = 1 ] && return 0
  [ "$(id -u)" = 0 ]
}

# apt_install PKG...: through apt-get on Debian and Ubuntu; returns 1 anywhere else.
apt_install() {
  command -v apt-get >/dev/null 2>&1 || return 1
  if [ "$DRY" = 1 ]; then say "would run: apt-get install -y $*"; return 0; fi
  DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null
}

need_tools() {
  missing=""
  for t in curl tar sha256sum openssl jq awk; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
  [ -n "$missing" ] || return 0
  say "Needs:$missing"
  pkgs=""
  for t in $missing; do
    case "$t" in sha256sum|tar|awk) pkgs="$pkgs coreutils tar gawk" ;; *) pkgs="$pkgs $t" ;; esac
  done
  if ask "Install$missing now?" && apt_install $pkgs; then return 0; fi
  die "Install$missing, then run this installer again."
}

check_openssl() {
  # Ed25519 raw verification (-rawin) needs OpenSSL 3.
  v=$(openssl version 2>/dev/null | awk '{print $2}')
  case "$v" in 3.*|[4-9].*) return 0 ;; esac
  die "OpenSSL 3 or newer is needed to check Vyre's signature (this machine has ${v:-none}). Update it, then run this installer again."
}

check_space() {
  d=$1
  while [ ! -d "$d" ]; do d=$(dirname "$d"); done
  free_mb=$(df -Pm "$d" 2>/dev/null | awk 'NR==2 {print $4}')
  [ -n "$free_mb" ] || return 0
  [ "$free_mb" -ge "$MIN_FREE_MB" ] || die "$d has $free_mb MB free; Vyre Server needs at least $MIN_FREE_MB MB (images, the Space, backups)."
}

# The data directory must sit on an encrypted volume (lead ruling Q1). Refuse, with the next step, when it does not.
check_encrypted() {
  d=$1
  probe=$d
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  disk_encrypted "$probe" && rc=0 || rc=$?
  case "$rc" in
    0) say "  ok  the data directory $d is on an encrypted volume" ;;
    *)
      printf 'vyre: the data directory %s is not on an encrypted volume%s.\n' "$d" "$([ "$rc" = 2 ] && printf ' that this installer can verify')" >&2
      cat >&2 <<EOF

Vyre keeps your Space's data, keys and backups here, so it will not install onto a plain disk.
Fix it one of these ways, then run the installer again:
  - put /srv (or the --data-dir you choose) on a LUKS volume:  cryptsetup luksFormat /dev/<device>; cryptsetup open /dev/<device> vyre-data; mkfs.ext4 /dev/mapper/vyre-data; mount /dev/mapper/vyre-data /srv
  - or choose a directory that is already on an encrypted volume with --data-dir
  - on a cloud machine, turn on full-disk encryption for the volume (or attach an encrypted one) and mount it there
EOF
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

# Docker Engine from Docker's own signed apt repository on Debian and Ubuntu. Anywhere else the person installs Docker and runs this again.
docker_apt_install() {
  osr=${VYRE_OS_RELEASE:-/etc/os-release}
  [ -r "$osr" ] || return 1
  os_id=$(. "$osr"; printf '%s' "${ID:-}")
  case "$os_id" in ubuntu|debian) ;; *) return 1 ;; esac
  command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1 || return 1
  os_code=$(. "$osr"; if [ "${ID:-}" = ubuntu ]; then printf '%s' "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"; else printf '%s' "${VERSION_CODENAME:-}"; fi)
  [ -n "$os_code" ] || return 1
  if [ "$DRY" = 1 ]; then say "would install Docker Engine and the Compose plugin from Docker's apt repository for $os_id $os_code"; return 0; fi
  say "  Installing Docker (about a minute)."
  export DEBIAN_FRONTEND=noninteractive
  {
    apt-get update -y && apt-get install -y ca-certificates curl \
      && install -m 0755 -d /etc/apt/keyrings \
      && curl -fsSL "https://download.docker.com/linux/$os_id/gpg" -o /etc/apt/keyrings/docker.asc \
      && chmod a+r /etc/apt/keyrings/docker.asc \
      && printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$os_id" "$os_code" >/etc/apt/sources.list.d/docker.list \
      && apt-get update -y \
      && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  } >"$TMP/docker-install.log" 2>&1 || die "Docker did not install. Its own output is in $TMP/docker-install.log (kept); after fixing that, run this installer again."
  command -v systemctl >/dev/null 2>&1 && systemctl enable --now docker >/dev/null 2>&1 || true
  return 0
}

need_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    if ask "Docker is not installed. Install Docker Engine from Docker's apt repository now?" && docker_apt_install; then
      [ "$DRY" = 1 ] && return 0
    else
      say "Vyre Server runs in Docker. Install Docker Engine and the Compose plugin (https://docs.docker.com/engine/install/), then run this installer again."
      exit 1
    fi
  fi
  if [ "$DRY" = 1 ] && ! command -v docker >/dev/null 2>&1; then return 0; fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running or not reachable by this account. Start it (systemctl start docker) and run this installer again."
  compose_ok || die "This machine needs Docker Compose 2.24 or newer (the docker compose plugin, found $(docker compose version --short 2>/dev/null || echo none)). Update docker-compose-plugin and run this installer again."
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
  openssl pkeyutl -verify -pubin -inkey "$key" -rawin -in "$TMP/signed.msg" -sigfile "$TMP/sig.bin" >/dev/null 2>&1
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
  case "$url" in http://*|https://*) ;; "") die "the manifest names no artifact; nothing was installed." ;; *) url="$base/$url" ;; esac
  say "  Downloading Vyre Server $REL_VERSION"
  fetch "$url" "$TMP/release.tgz" 900 || die "could not download $url; nothing was installed."
  got=$(sha256sum "$TMP/release.tgz" | awk '{print $1}')
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

# ---- configuration, units, start ---------------------------------------------------------------------------------------------------
# lock_get KEY: a value from the release's images.lock.
lock_get() { sed -n "s/^$1=\\(.*\\)\$/\\1/p" "$DIR/releases/$REL_VERSION/images.lock" 2>/dev/null | head -n 1; }

# space_id: the Space's id. The daemon refuses to boot a data directory that has no Space, and compose passes an empty VYRE_SPACE through as empty,
# so the installer names one: the id of an earlier install (compose.env), else one handed in (VYRE_SPACE), else a new spc_ id. A re-run keeps it.
space_id() {
  _s=$(sed -n 's/^VYRE_SPACE=\(.*\)$/\1/p' "$DIR/compose.env" 2>/dev/null | head -n 1)
  [ -n "$_s" ] || _s=${VYRE_SPACE:-}
  [ -n "$_s" ] || _s=spc_$(openssl rand -hex 12)
  printf '%s' "$_s"
}

write_config() {
  if [ "$DRY" = 1 ]; then say "would write $DIR/vyre.env (0600), $DIR/compose.env and $DIR/compose.override.yml, and create $DATA_DIR"; return 0; fi
  mkdir -p "$DIR" "$DATA_DIR/space" "$DATA_DIR/work" "$DATA_DIR/caddy" "$DATA_DIR/caddy-config" "$DIR/backups" "$DIR/state"
  chmod 0700 "$DATA_DIR" "$DIR/backups"
  # vyred runs as uid 1000 (the node user of the image) and writes the Space and the work folder; Caddy runs as root in its own container.
  chown 1000:1000 "$DATA_DIR/space" "$DATA_DIR/work" 2>/dev/null || [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "could not give the data folders to the server's user (uid 1000)."
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
  cat >"$DIR/compose.override.yml" <<EOF
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
EOF
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
  # The command is a small wrapper that runs the current release's own script, so an update changes it too.
  cat >"$BIN_DIR/vyre-server.new" <<EOF
#!/bin/sh
# $MARK
exec "$DIR/current/bin/vyre-server" "\$@"
EOF
  chmod 0755 "$BIN_DIR/vyre-server.new"
  mv "$BIN_DIR/vyre-server.new" "$BIN_DIR/vyre-server"
  printf 'VYRE_DIR=%s\n' "$DIR" >"$DIR/state/install.env"
}

write_units() {
  if [ "$DRY" = 1 ]; then say "would write $UNIT_DIR/vyre-server.service, vyre-server-update.service and vyre-server-update.timer and enable them"; return 0; fi
  install -d "$UNIT_DIR"
  for u in vyre-server.service vyre-server-update.service vyre-server-update.timer; do
    sed -e "s|@VYRE_DIR@|$DIR|g" -e "s|@BIN@|$BIN_DIR/vyre-server|g" -e "s|@MARK@|$MARK|g" "$DIR/releases/$REL_VERSION/units/$u" >"$UNIT_DIR/$u.new"
    chmod 0644 "$UNIT_DIR/$u.new"
    mv "$UNIT_DIR/$u.new" "$UNIT_DIR/$u"
  done
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
    systemctl enable vyre-server.service >/dev/null 2>&1 || true
    systemctl enable --now vyre-server-update.timer >/dev/null 2>&1 || true
  fi
}

pull_images() {
  for k in VYRE_IMAGE VYRE_AGENT_IMAGE VYRE_SANDBOX_IMAGE; do
    ref=$(lock_get "$k")
    [ -n "$ref" ] || continue
    case "$ref" in *@sha256:*) ;; *) die "the release names $k without a digest ($ref); nothing was started." ;; esac
    if [ "$DRY" = 1 ]; then say "would run: docker pull $ref"; continue; fi
    say "  Pulling $ref"
    docker pull -q "$ref" >/dev/null || die "could not pull $ref; check this machine's network (and the registry) and run the installer again."
  done
}

start_stack() {
  if [ "$DRY" = 1 ]; then say "would start the server: systemctl start vyre-server.service (docker compose up -d)"; return 0; fi
  if command -v systemctl >/dev/null 2>&1 && [ "${VYRE_TEST_MODE:-0}" != 1 ]; then
    systemctl start vyre-server.service || die "the server did not start; read: journalctl -u vyre-server.service"
  else
    "$DIR/current/bin/vyre-server" start || die "the server did not start; read: vyre-server logs"
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
    say "That is the whole plan. Nothing on this machine changed. Run it again without --dry-run when you are ready."
  else
    say "Vyre Server $REL_VERSION is running."
    if [ -n "$DOMAIN" ]; then say "Your Space will answer at https://$DOMAIN once its certificate is issued (ports 80 and 443 must reach this machine)."
    elif [ -n "$RELAY" ]; then say "It connects outward to $RELAY; no public port is open on this machine."
    else say "Choose how people reach it: run the installer again with --domain NAME or --relay."
    fi
    say "Go back to the Vyre app to finish setting up this server."
    say "Check it any time with: vyre-server doctor"
  fi
  say ""
}

uninstall() {
  [ -d "$DIR" ] || die "nothing is installed at $DIR."
  if [ "$PURGE" = 1 ] && ! ask "Delete the Space's data and every backup under $DIR? This cannot be undone."; then die "not purged."; fi
  if command -v systemctl >/dev/null 2>&1; then
    run systemctl disable --now vyre-server-update.timer || true
    run systemctl disable --now vyre-server.service || true
  fi
  if [ -x "$DIR/current/bin/vyre-server" ]; then run "$DIR/current/bin/vyre-server" stop || true; fi
  for u in vyre-server.service vyre-server-update.service vyre-server-update.timer; do
    if [ -f "$UNIT_DIR/$u" ] && grep -q "$MARK" "$UNIT_DIR/$u"; then run rm -f "$UNIT_DIR/$u"; fi
  done
  if [ -f "$BIN_DIR/vyre-server" ] && grep -q "$MARK" "$BIN_DIR/vyre-server"; then run rm -f "$BIN_DIR/vyre-server"; fi
  command -v systemctl >/dev/null 2>&1 && run systemctl daemon-reload || true
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
  case "$(uname -s)" in Linux) ;; *) [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "this installer is for Linux; on a Mac use the Mac installer." ;; esac
  case "$(uname -m)" in x86_64|amd64|aarch64|arm64) ;; *) die "Vyre Server runs on x86_64 and arm64; this machine is $(uname -m)." ;; esac
  is_root || die "run this as root (for example: curl -fsSL https://vyre.run/install.sh | sudo sh)."
  if [ "$UNINSTALL" = 1 ]; then uninstall; return 0; fi
  say "Installing Vyre Server on this machine. It checks the download against Vyre's signature before installing anything."
  need_tools
  check_openssl
  check_encrypted "$DATA_DIR"
  check_space "$DATA_DIR"
  need_docker
  fetch_release
  unpack_release
  write_config
  link_current
  write_units
  pull_images
  start_stack
  wait_green
  finish
}

if [ "${VYRE_SOURCE_ONLY:-0}" != 1 ]; then main "$@"; fi
