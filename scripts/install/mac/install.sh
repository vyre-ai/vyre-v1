#!/bin/sh
# install.sh (Mac): put Vyre Server on a Mac. This is what `curl -fsSL https://vyre.run/install.sh | sh` runs on macOS, and what `vyre-server` is installed by.
# Spec 3.13 (Install: "on a Mac, a small Linux VM"), ARCH 7.13, R18 (S14).
#
#   --dry-run          print every change, make none (read-only checks still run)
#   --yes              answer yes to every question
#   --channel C        stable (default), beta or nightly
#   --version V        install release V; the channel's manifest must name exactly that version
#   --domain NAME      serve this Space on your own domain (Caddy gets the certificate by ACME, ports 80 and 443 must reach this Mac)
#   --relay [URL]      serve through Vyre's relay instead (default https://relay.vyre.run); the Mac opens no public port
#   --data-dir DIR     where the Space's data lives (default $VYRE_DIR/data); must be on an encrypted volume (FileVault)
#   --uninstall        stop the server, remove the launchd jobs and /usr/local/bin/vyre-server; data and backups stay
#   --purge            with --uninstall: also delete the data, the backups and the tools, after asking
#
# Environment: VYRE_DIR (default ~/.vyre-server), VYRE_UPDATE_URL (default https://vyre.run/server/), VYRE_CODE (the one-time setup code the Vyre app makes
# when a server is added, for the install line `curl -fsSL https://vyre.run/install.sh | VYRE_CODE=... sh`; it is written only to $VYRE_DIR/vyre.env at
# mode 0600 and is never printed or taken as an argument).
#
# Run it as your own account, never as root. It asks for your password for the two things that need it: the launchd jobs in /Library/LaunchDaemons (so
# everything comes back after a restart with nobody signed in) and the vyre-server command in /usr/local/bin.
#
# What it does, in order, and stops at the first thing that is wrong:
#   1. checks the Mac: macOS 13 or newer, 4 GB of memory or more, 10 GB free, curl/tar/awk, and that the data directory sits on an ENCRYPTED volume
#      (FileVault on the startup volume, or an encrypted volume under /Volumes). Without one it refuses and says how to fix it. There is no switch around this.
#   2. picks the container runtime: Docker Desktop when it is installed, else Colima (open source, headless), installed from pinned, checksummed releases
#      (Colima, Lima, the docker client and Compose) into $VYRE_DIR/tools, so nothing in Homebrew or your own folders is trusted or changed.
#   3. downloads the pinned Node (checked against its published sha256) and uses it to check the channel's signed manifest: an Ed25519 signature over
#      "vyre-release-sums\n" and the exact manifest bytes, against the Vyre release key in this script (the same scheme the server's updater checks). The
#      release tarball is then checked against the manifest's sha256. A bad signature or hash stops everything.
#   4. unpacks the release, writes vyre.env (0600), compose.env (with the Space's id) and a compose override that keeps the data under the data directory,
#      writes the launchd jobs (Colima, the server, a daily update check), pulls the images by digest and starts the server.
#   5. waits for `vyre-server doctor` to be green and says what to do next.
#
# A Mac release tarball unpacks to one folder holding: VERSION, compose.server.yml, Caddyfile, images.lock (KEY=value lines VYRE_IMAGE=...@sha256:,
# VYRE_AGENT_IMAGE=...@sha256:, VYRE_SANDBOX_IMAGE=...@sha256:), bin/vyre-server and units/ (the three launchd plists). The channel manifest names it under
# "server_mac" ({ version, tarball, sha256 }), beside the Linux artifact under "server".
#
# Everything lives inside functions and main is called on the last line, so the shell has read the whole script before anything runs: piped from curl, a
# command that reads stdin would otherwise eat the rest of the script. VYRE_SOURCE_ONLY=1 loads the functions and runs nothing (tests).

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
RUNTIME=colima

DIR=${VYRE_DIR:-$HOME/.vyre-server}
UPDATE_URL=${VYRE_UPDATE_URL:-https://vyre.run/server/}
BIN_DIR=${VYRE_BIN_DIR:-/usr/local/bin}
PLIST_DIR=${VYRE_LAUNCHD_DIR:-/Library/LaunchDaemons}
LAUNCHCTL=${VYRE_LAUNCHCTL:-launchctl}
SUDO=${VYRE_SUDO-sudo}
ME=${USER:-$(id -un)}
DEFAULT_RELAY=https://relay.vyre.run
MIN_FREE_MB=${VYRE_MIN_FREE_MB:-10240}
LABELS="run.vyre.colima run.vyre.server run.vyre.server-update"
# The mark only our script writes into plists and the command, so we never replace or remove someone else's file.
MARK="Vyre Server, installed by install.sh"

# Pinned releases for the Colima runtime. Each sum is the publisher's own: Colima's colima-Darwin-*.sha256sum (v0.10.3), Lima's SHA256SUMS (v2.2.0), the
# docker static client (computed from the download, Docker publishes no sums file), Compose's docker-compose-darwin-*.sha256 (v2.32.4) and Node's SHASUMS256.txt
# (v22.23.3). An empty sum means "no pinned build": the installer refuses rather than run an unchecked file. VYRE_*_URL and VYRE_*_SHA256 override them in tests.
COLIMA_VERSION=v0.10.3
COLIMA_SHA256_ARM64=980ad8bf61a4ca370243f4cb41401a61276dcd2c2502bee7b9b86f9250169f34
COLIMA_SHA256_AMD64=3082737fe8a98afda11cba7d9a20b6e56fe80c6153464beda04bec630758770b
LIMA_VERSION=2.2.0
LIMA_SHA256_ARM64=bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3
LIMA_SHA256_AMD64=0d6f99c19f6e4bc3c92730c4c29d929e6927f0cb0a0ba1a84383367135a8ff31
DOCKER_VERSION=29.8.1
DOCKER_SHA256_ARM64=5a8f5604d7673202b2af925229d15eb4bbb86f7f542e4ac8cd7aa3f14cfa0f8b
DOCKER_SHA256_AMD64=de42b6bb38d0ea08333cdddc18b054d61d4c9f003b3616ae55d85ccea72c47c9
COMPOSE_VERSION=v2.32.4
COMPOSE_SHA256_ARM64=dc30b0276c0ba45857eef021b677d4fb2bbf13bcf809f99b691db9512bca47cc
COMPOSE_SHA256_AMD64=bd6f3b3b93032f47ad2c017e92df302651c9a649f4b533455371877eaaa76585
NODE_VERSION=v22.23.3
NODE_SHA256_ARM64=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53
NODE_SHA256_X64=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8

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

# priv CMD...: a change that needs the administrator password (launchd jobs, /usr/local/bin). In --dry-run it is only printed.
priv() {
  if [ "$DRY" = 1 ]; then say "would run as administrator: $(show "$@")"; else $SUDO "$@"; fi
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
# macOS: a folder on the startup volume is encrypted when `fdesetup status` says "FileVault is On."; a folder on another volume (/Volumes/NAME/...) when
# `diskutil info` says "FileVault: Yes" or "Encrypted: Yes" for that volume. Anything else, including a network share, is not.
disk_encrypted() {
  _d=$1
  _fde=fdesetup
  _du=diskutil
  if [ "${VYRE_TEST_MODE:-0}" = 1 ]; then [ -z "${VYRE_TEST_FDESETUP:-}" ] || _fde=$VYRE_TEST_FDESETUP; [ -z "${VYRE_TEST_DISKUTIL:-}" ] || _du=$VYRE_TEST_DISKUTIL; fi
  case "$_d" in
    /Volumes/*)
      _rest=${_d#/Volumes/}
      _info=$("$_du" info "/Volumes/${_rest%%/*}" 2>/dev/null) || return 2
      case "$_info" in
        *"FileVault:"*"Yes"*|*"Encrypted:"*"Yes"*) return 0 ;;
        "") return 2 ;;
      esac
      return 1 ;;
  esac
  _s=$("$_fde" status 2>/dev/null) || return 2
  case "$_s" in
    *"FileVault is On"*) return 0 ;;
    *"FileVault is Off"*) return 1 ;;
  esac
  return 2
}
# END diskcheck

# ---- versions -----------------------------------------------------------------------------------------------------------------------
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

usage() { sed -n '2,14p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

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

# ---- the Mac ------------------------------------------------------------------------------------------------------------------------
# The kind of CPU, as the pinned release names it: arm64 or x86_64.
cpu() {
  case "${VYRE_UNAME_M:-$(uname -m)}" in
    arm64|aarch64) printf arm64 ;;
    x86_64|amd64) printf x86_64 ;;
    *) die "Vyre Server runs on Apple silicon and Intel Macs; this one is $(uname -m)." ;;
  esac
}

need_tools() {
  missing=""
  for t in curl tar awk sed; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
  { command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; } || missing="$missing shasum"
  [ -z "$missing" ] || die "this Mac is missing$missing, which macOS normally includes. Install the Xcode command line tools (xcode-select --install) and run this installer again."
}

check_macos() {
  v=${VYRE_MACOS_VERSION:-$(sw_vers -productVersion 2>/dev/null || printf 0)}
  major=${v%%.*}
  [ "${major:-0}" -ge 13 ] 2>/dev/null || die "Vyre Server needs macOS 13 or newer for its container runtime (this Mac has ${v:-an unknown version}). Update macOS and run this installer again."
}

# memory_gib: this Mac's memory in whole GiB. VYRE_RAM_BYTES is for tests.
memory_gib() {
  b=${VYRE_RAM_BYTES:-$(sysctl -n hw.memsize 2>/dev/null || printf 0)}
  printf '%s' $((b / 1073741824))
}

# The VM gets 2 GiB plus 2.5 GiB for the Space (5 GiB), never under 4 GiB and never over half the Mac's memory; 2 CPUs, 4 on a Mac with 8 or more cores; 60 GiB of (sparse) disk.
colima_size() {
  gib=$(memory_gib)
  [ "$gib" -ge 4 ] || die "this Mac has ${gib} GB of memory; Vyre Server needs at least 4 GB to run agents' computers. Use a Mac with more memory, or a Linux server."
  mem=5
  half=$((gib / 2))
  [ "$mem" -le "$half" ] || mem=$half
  [ "$mem" -ge 4 ] || mem=4
  cpus=2
  cores=${VYRE_NCPU:-$(sysctl -n hw.ncpu 2>/dev/null || printf 2)}
  [ "$cores" -lt 8 ] || cpus=4
  COLIMA_MEM_GIB=$mem
  COLIMA_CPU_COUNT=$cpus
}

check_space() {
  d=$1
  while [ ! -d "$d" ]; do d=$(dirname "$d"); done
  free_mb=$(df -Pm "$d" 2>/dev/null | awk 'NR==2 {print $4}')
  [ -n "$free_mb" ] || return 0
  [ "$free_mb" -ge "$MIN_FREE_MB" ] || die "$d has $free_mb MB free; Vyre Server needs at least $MIN_FREE_MB MB (images, the Space, backups)."
}

# The data directory must sit on an encrypted volume (lead ruling Q1): FileVault on a Mac. Refuse, with the next step, when it does not.
check_encrypted() {
  d=$1
  probe=$d
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  disk_encrypted "$probe" && rc=0 || rc=$?
  case "$rc" in
    0) say "  ok  the data directory $d is on an encrypted volume (FileVault)" ;;
    *)
      printf 'vyre: the data directory %s is not on an encrypted volume%s.\n' "$d" "$([ "$rc" = 2 ] && printf ' that this installer can verify')" >&2
      cat >&2 <<EOT

Vyre keeps your Space's data, keys and backups here, so it will not install onto a plain disk.
Fix it one of these ways, then run the installer again:
  - turn on FileVault: System Settings, Privacy and Security, FileVault, Turn On (it takes a restart, and the disk encrypts in the background)
  - or choose a folder on a volume that is already encrypted with --data-dir /Volumes/NAME/vyre
EOT
      exit 3
      ;;
  esac
}


# ---- the container runtime ----------------------------------------------------------------------------------------------------------
# dl URL FILE: a download that fails loudly (file:// works, for tests).
dl() { curl -fsSL --retry 3 --retry-delay 2 --max-time 900 "$1" -o "$2"; }

# fetch_pinned NAME URL SHA FILE: download and check against the pinned sum before anything is unpacked or installed. An empty sum refuses.
fetch_pinned() {
  [ -n "$3" ] || die "this installer has no pinned $1 for this Mac; nothing was installed."
  dl "$2" "$4" || die "could not download $1 ($2); check this Mac's network and run the installer again."
  got=$(sha256 "$4")
  [ "$got" = "$3" ] || die "the $1 download does not match its pinned checksum (wanted $3, got $got); nothing was installed."
}

# install_node: the pinned Node that checks the release signature. Nothing of the person's (Homebrew, nvm) is used for that: their libraries are theirs to change.
install_node() {
  [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ -n "${VYRE_VERIFY_NODE:-}" ] && return 0
  if [ "$DRY" = 1 ]; then say "would download Node $NODE_VERSION (pinned sha256) to $DIR/tools/node"; return 0; fi
  [ ! -x "$DIR/tools/node/bin/node" ] || return 0
  case "$(cpu)" in arm64) na=arm64; ns=${VYRE_NODE_SHA256-$NODE_SHA256_ARM64} ;; *) na=x64; ns=${VYRE_NODE_SHA256-$NODE_SHA256_X64} ;; esac
  say "  Downloading Node $NODE_VERSION (checked against its published checksum)"
  fetch_pinned "Node" "${VYRE_NODE_URL:-https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$na.tar.gz}" "$ns" "$TMP/node.tgz"
  rm -rf "$TMP/node" "$DIR/tools/node"
  mkdir -p "$TMP/node" "$DIR/tools"
  tar -xzf "$TMP/node.tgz" -C "$TMP/node" --strip-components=1 || die "the Node download did not unpack; nothing was installed."
  [ -x "$TMP/node/bin/node" ] || die "the Node download has no node in it; nothing was installed."
  mv "$TMP/node" "$DIR/tools/node"
}

# choose_runtime: Docker Desktop when it is installed (the person already runs it), else Colima.
choose_runtime() {
  if [ -d "${VYRE_DOCKER_APP:-/Applications/Docker.app}" ]; then RUNTIME=desktop
  elif [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ -n "${VYRE_TEST_RUNTIME:-}" ]; then RUNTIME=$VYRE_TEST_RUNTIME
  else RUNTIME=colima; fi
  case "$RUNTIME" in colima) say "  Container runtime: Colima (installed by this installer)" ;; *) say "  Container runtime: Docker Desktop (already installed)" ;; esac
}

# install_colima: pinned Colima, Lima, the docker client and Compose into $DIR/tools. Everything is checked before anything is installed; a bad download installs nothing.
install_colima() {
  if [ "$DRY" = 1 ]; then say "would download Colima $COLIMA_VERSION, Lima $LIMA_VERSION, docker $DOCKER_VERSION and Compose $COMPOSE_VERSION (pinned sha256) to $DIR/tools"; return 0; fi
  a=$(cpu)
  case "$a" in
    arm64) da=aarch64; cs=${VYRE_COLIMA_SHA256-$COLIMA_SHA256_ARM64}; ls=${VYRE_LIMA_SHA256-$LIMA_SHA256_ARM64}; ds=${VYRE_DOCKER_SHA256-$DOCKER_SHA256_ARM64}; ps=${VYRE_COMPOSE_SHA256-$COMPOSE_SHA256_ARM64} ;;
    *) da=x86_64; cs=${VYRE_COLIMA_SHA256-$COLIMA_SHA256_AMD64}; ls=${VYRE_LIMA_SHA256-$LIMA_SHA256_AMD64}; ds=${VYRE_DOCKER_SHA256-$DOCKER_SHA256_AMD64}; ps=${VYRE_COMPOSE_SHA256-$COMPOSE_SHA256_AMD64} ;;
  esac
  say "  Downloading Colima, Lima, docker and Compose (checked against pinned checksums)"
  mkdir -p "$TMP/cl"
  fetch_pinned "Colima" "${VYRE_COLIMA_URL:-https://github.com/abiosoft/colima/releases/download/$COLIMA_VERSION/colima-Darwin-$a}" "$cs" "$TMP/cl/colima"
  fetch_pinned "Lima" "${VYRE_LIMA_URL:-https://github.com/lima-vm/lima/releases/download/v$LIMA_VERSION/lima-$LIMA_VERSION-Darwin-$a.tar.gz}" "$ls" "$TMP/cl/lima.tgz"
  fetch_pinned "docker client" "${VYRE_DOCKER_URL:-https://download.docker.com/mac/static/stable/$da/docker-$DOCKER_VERSION.tgz}" "$ds" "$TMP/cl/docker.tgz"
  fetch_pinned "Compose" "${VYRE_COMPOSE_URL:-https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-darwin-$da}" "$ps" "$TMP/cl/compose"
  mkdir -p "$TMP/cl/lima" "$TMP/cl/docker"
  tar -xzf "$TMP/cl/lima.tgz" -C "$TMP/cl/lima" || die "the Lima download did not unpack; nothing was installed."
  [ -f "$TMP/cl/lima/bin/limactl" ] || die "the Lima download has no limactl in it; nothing was installed."
  tar -xzf "$TMP/cl/docker.tgz" -C "$TMP/cl/docker" || die "the docker client did not unpack; nothing was installed."
  [ -f "$TMP/cl/docker/docker/docker" ] || die "the docker download has no client in it; nothing was installed."
  mkdir -p "$DIR/tools/bin"
  cp "$TMP/cl/colima" "$DIR/tools/bin/colima"
  cp "$TMP/cl/docker/docker/docker" "$DIR/tools/bin/docker"
  cp "$TMP/cl/compose" "$DIR/tools/bin/docker-compose"
  chmod 0755 "$DIR/tools/bin/colima" "$DIR/tools/bin/docker" "$DIR/tools/bin/docker-compose"
  rm -rf "$DIR/tools/lima"
  cp -R "$TMP/cl/lima" "$DIR/tools/lima"
  say "  ok  Colima $COLIMA_VERSION, Lima $LIMA_VERSION, docker $DOCKER_VERSION and Compose $COMPOSE_VERSION are in $DIR/tools"
}

# Write the VM's size where the Colima job reads it (vyre-server colima-run).
write_colima_size() {
  colima_size
  [ "$DRY" = 1 ] && { say "would size the Colima VM at $COLIMA_CPU_COUNT CPUs, $COLIMA_MEM_GIB GiB of memory, 60 GiB of disk"; return 0; }
  printf 'COLIMA_CPUS=%s\nCOLIMA_MEM=%s\nCOLIMA_DISK=60\nCOLIMA_VM=vz\n' "$COLIMA_CPU_COUNT" "$COLIMA_MEM_GIB" >"$DIR/colima-size.env"
}

# With --domain, Caddy must be reachable from outside. Lima forwards guest ports to 127.0.0.1 only; this override asks it to forward 80 and 443 on every interface.
write_lima_forwards() {
  [ "$RUNTIME" = colima ] && [ -n "$DOMAIN" ] || return 0
  if [ "$DRY" = 1 ]; then say "would write $HOME/.colima/_lima/_config/override.yaml to forward ports 80 and 443 on every interface"; return 0; fi
  mkdir -p "$HOME/.colima/_lima/_config"
  cat >"$HOME/.colima/_lima/_config/override.yaml" <<EOT
# $MARK: --domain needs ports 80 and 443 reachable from outside this Mac.
portForwards:
  - guestPort: 80
    hostIP: "0.0.0.0"
  - guestPort: 443
    hostIP: "0.0.0.0"
EOT
}

# runtime_env: point docker at the runtime this install uses.
runtime_env() {
  PATH="$DIR/tools/bin:$DIR/tools/lima/bin:$PATH"; export PATH
  if [ "$RUNTIME" = colima ]; then DOCKER_HOST=${VYRE_DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}; export DOCKER_HOST; fi
}

# wait_docker: Docker answers (the Colima job needs a minute or two to start the VM the first time, and downloads its image).
wait_docker() {
  [ "$DRY" = 1 ] && return 0
  say "  Waiting for Docker (up to ${VYRE_RUNTIME_WAIT:-600} s; the first start downloads the VM image)"
  n=0
  if [ "$RUNTIME" = desktop ] && ! docker info >/dev/null 2>&1 && [ "${VYRE_TEST_MODE:-0}" != 1 ]; then open -a Docker >/dev/null 2>&1 || true; fi
  until docker info >/dev/null 2>&1; do
    n=$((n + 3))
    [ "$n" -lt "${VYRE_RUNTIME_WAIT:-600}" ] || die "Docker did not answer. $( [ "$RUNTIME" = colima ] && printf 'Read: %s/logs/colima.log' "$DIR" || printf 'Open Docker Desktop, then run this installer again.')"
    sleep 3
  done
  v=$(docker compose version --short 2>/dev/null || docker-compose version --short 2>/dev/null || true)
  [ -n "$v" ] || die "Docker Compose is not available; run this installer again."
  say "  ok  Docker answers (Compose $v)"
}

# BEGIN release
# The Vyre release public key (Ed25519). The private half lives only in the `release` GitHub Environment. VYRE_RELEASE_KEY_PEM (a file) is for tests.
# macOS ships LibreSSL, which cannot verify Ed25519, so the signature is checked with the pinned Node the installer downloads (VYRE_VERIFY_NODE is for tests).
RELEASE_KEY_PEM='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKXSdujH7tO/gscXCJZmYCjB+Cv1sVlOfdgLNedMR7FU=
-----END PUBLIC KEY-----'

# sha256 FILE: the hex digest, with whichever tool the Mac has.
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else die "need shasum or sha256sum to check downloads"; fi
}

# release_key_b64: the key's base64 line (the SPKI of an Ed25519 key is one line).
release_key_b64() {
  if [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ -n "${VYRE_RELEASE_KEY_PEM:-}" ]; then sed -n '2p' "$VYRE_RELEASE_KEY_PEM"; return 0; fi
  printf '%s\n' "$RELEASE_KEY_PEM" | sed -n '2p'
}

# verify_node: the Node that checks the signature. The installer's own pinned copy, or VYRE_VERIFY_NODE in tests.
verify_node() {
  if [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ -n "${VYRE_VERIFY_NODE:-}" ]; then printf '%s' "$VYRE_VERIFY_NODE"; return 0; fi
  printf '%s' "$DIR/tools/node/bin/node"
}

# jget FILE PATH: one field of a JSON file ("server_mac.version"), empty when it is missing. The pinned Node reads it; older macOS versions have no jq.
jget() {
  "$(verify_node)" -e 'let v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); for (const k of process.argv[2].split(".")) v = v == null ? undefined : v[k]; process.stdout.write(v == null ? "" : String(v));' "$1" "$2"
}

# ---- the signed release -------------------------------------------------------------------------------------------------------------
# verify_manifest MANIFEST SIG_B64FILE: Ed25519 over "vyre-release-sums\n" followed by the exact manifest bytes.
verify_manifest() {
  { printf 'vyre-release-sums\n'; cat "$1"; } >"$TMP/signed.msg"
  "$(verify_node)" -e '
const c = require("crypto"), f = require("fs");
const [key, msg, sigf] = process.argv.slice(1);
const pub = c.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
const sig = Buffer.from(f.readFileSync(sigf, "utf8").replace(/\s+/g, ""), "base64");
process.exit(sig.length === 64 && c.verify(null, f.readFileSync(msg), pub, sig) ? 0 : 1);
' "$(release_key_b64)" "$TMP/signed.msg" "$2" >/dev/null 2>&1
}

fetch() { curl -fsSL --retry 3 --retry-delay 2 --max-time "${3:-120}" "$1" -o "$2"; }

# fetch_release: the channel's manifest and the Mac release tarball, both checked. Sets REL_VERSION and REL_TARBALL (a checked file).
# The manifest names the Mac artifact under "server_mac" ({ version, tarball, sha256 }) beside the Linux one under "server".
fetch_release() {
  base=${UPDATE_URL%/}
  say "  Fetching the $CHANNEL release manifest from $base/"
  fetch "$base/$CHANNEL.json" "$TMP/manifest.json" 30 || die "could not reach $base/$CHANNEL.json; check this Mac's network and run the installer again."
  fetch "$base/$CHANNEL.json.sig" "$TMP/manifest.sig" 30 || die "could not fetch the manifest's signature; nothing was installed."
  verify_manifest "$TMP/manifest.json" "$TMP/manifest.sig" || die "the release signature does not match the Vyre release key in this installer; nothing was installed."
  say "  ok  the release signature verifies"
  [ "$(jget "$TMP/manifest.json" v)" = 1 ] || die "the release manifest is not a version this installer reads; nothing was installed."
  [ "$(jget "$TMP/manifest.json" channel)" = "$CHANNEL" ] || die "the manifest is for another channel than $CHANNEL; nothing was installed."
  REL_VERSION=$(jget "$TMP/manifest.json" server_mac.version)
  url=$(jget "$TMP/manifest.json" server_mac.tarball)
  sum=$(jget "$TMP/manifest.json" server_mac.sha256)
  ver_cmp "$REL_VERSION" "$REL_VERSION" >/dev/null 2>&1 || die "the manifest has no Mac server version; nothing was installed."
  case "$sum" in *[!0-9a-f]*|"") die "the manifest does not give the artifact's sha256; nothing was installed." ;; esac
  [ "${#sum}" = 64 ] || die "the manifest does not give the artifact's sha256; nothing was installed."
  if [ -n "$WANT" ] && [ "$WANT" != latest ] && [ "$WANT" != "$REL_VERSION" ]; then
    die "the $CHANNEL channel offers $REL_VERSION, not $WANT; nothing was installed."
  fi
  case "$url" in http://*|https://*|file://*) ;; "") die "the manifest names no artifact; nothing was installed." ;; *) url="$base/$url" ;; esac
  say "  Downloading Vyre Server $REL_VERSION"
  fetch "$url" "$TMP/release.tgz" 900 || die "could not download $url; nothing was installed."
  got=$(sha256 "$TMP/release.tgz")
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
  tar -xzf "$REL_TARBALL" -C "$rel.part" --strip-components=1
  for f in VERSION compose.server.yml Caddyfile images.lock bin/vyre-server units/run.vyre.server.plist units/run.vyre.colima.plist units/run.vyre.server-update.plist; do
    [ -f "$rel.part/$f" ] || { rm -rf "$rel.part"; die "the release has no $f; nothing was installed."; }
  done
  [ "$(cat "$rel.part/VERSION")" = "$REL_VERSION" ] || { rm -rf "$rel.part"; die "the release's VERSION file does not match its manifest; nothing was installed."; }
  chmod 0755 "$rel.part/bin/vyre-server"
  : >"$rel.part/.complete"
  rm -rf "$rel"
  mv "$rel.part" "$rel"
}
# END release

# ---- configuration, launchd jobs, start -----------------------------------------------------------------------------------------------
# lock_get KEY: a value from the release's images.lock.
lock_get() { sed -n "s/^$1=\\(.*\\)\$/\\1/p" "$DIR/releases/$REL_VERSION/images.lock" 2>/dev/null | head -n 1; }

# space_id: the Space's id. The daemon refuses to boot a data directory that has no Space, and compose passes an empty VYRE_SPACE through as empty,
# so the installer names one: the id of an earlier install (compose.env), else one handed in (VYRE_SPACE), else a new spc_ id. A re-run keeps it.
space_id() {
  _s=$(sed -n 's/^VYRE_SPACE=\(.*\)$/\1/p' "$DIR/compose.env" 2>/dev/null | head -n 1)
  [ -n "$_s" ] || _s=${VYRE_SPACE:-}
  [ -n "$_s" ] || _s=spc_$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
  printf '%s' "$_s"
}

write_config() {
  if [ "$DRY" = 1 ]; then say "would write $DIR/vyre.env (0600), $DIR/compose.env and $DIR/compose.override.yml, and create $DATA_DIR"; return 0; fi
  mkdir -p "$DIR" "$DATA_DIR/space" "$DATA_DIR/work" "$DATA_DIR/caddy" "$DATA_DIR/caddy-config" "$DIR/backups" "$DIR/state" "$DIR/logs"
  chmod 0700 "$DATA_DIR" "$DIR/backups"
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
  printf '%s\n' "$RUNTIME" >"$DIR/runtime"
  # The Space's data is bind-mounted from the Mac into the VM. With Colima the VM mounts the data folder writable (vyre-server colima-run).
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
  [ "$DRY" = 1 ] && { say "would point $DIR/current at releases/$REL_VERSION and put the vyre-server command in $BIN_DIR"; return 0; }
  if [ -L "$DIR/current" ]; then
    prev=$(readlink "$DIR/current")
    [ "$prev" = "releases/$REL_VERSION" ] || printf '%s\n' "$prev" >"$DIR/previous"
  fi
  ln -sfn "releases/$REL_VERSION" "$DIR/current.new"
  mv -fh "$DIR/current.new" "$DIR/current" 2>/dev/null || { rm -f "$DIR/current"; mv "$DIR/current.new" "$DIR/current"; }
  ln -sfn "$DIR/vyre.env" "$DIR/releases/$REL_VERSION/vyre.env"
  # The command is a small wrapper that runs the current release's own script, so an update changes it too. /usr/local/bin is root's: one password.
  cat >"$TMP/vyre-server.wrapper" <<EOT
#!/bin/sh
# $MARK
VYRE_DIR="$DIR"; export VYRE_DIR
exec "$DIR/current/bin/vyre-server" "\$@"
EOT
  chmod 0755 "$TMP/vyre-server.wrapper"
  priv mkdir -p "$BIN_DIR"
  priv cp "$TMP/vyre-server.wrapper" "$BIN_DIR/vyre-server.new"
  priv mv -f "$BIN_DIR/vyre-server.new" "$BIN_DIR/vyre-server"
  printf 'VYRE_DIR=%s\n' "$DIR" >"$DIR/state/install.env"
}

# plist_for LABEL: the label's file name.
plist_for() { printf '%s/%s.plist' "$PLIST_DIR" "$1"; }

# The jobs this install needs: Colima only when Colima is the runtime.
labels_now() {
  for l in $LABELS; do
    [ "$l" != run.vyre.colima ] || [ "$RUNTIME" = colima ] || continue
    printf '%s ' "$l"
  done
}

# write_units: the three launchd jobs as LaunchDaemons (they run at boot with nobody signed in, as this account). The first line of each file carries the mark.
write_units() {
  if [ "$DRY" = 1 ]; then say "would write the launchd jobs ($(labels_now)) to $PLIST_DIR, owned by root"; return 0; fi
  for l in $(labels_now); do
    src="$DIR/releases/$REL_VERSION/units/$l.plist"
    sed -e "s|@VYRE_DIR@|$DIR|g" -e "s|@BIN@|$BIN_DIR/vyre-server|g" -e "s|@USER@|$ME|g" -e "s|@HOME@|$HOME|g" -e "s|@MARK@|$MARK|g" "$src" >"$TMP/$l.plist"
    chmod 0644 "$TMP/$l.plist"
    priv mkdir -p "$PLIST_DIR"
    priv cp "$TMP/$l.plist" "$(plist_for "$l").new"
    priv chown root:wheel "$(plist_for "$l").new" 2>/dev/null || [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "could not hand $l.plist to root."
    priv mv -f "$(plist_for "$l").new" "$(plist_for "$l")"
  done
}

# load_job LABEL: (re)load one job into the system domain.
load_job() {
  l=$1
  if [ "$DRY" = 1 ]; then say "would run as administrator: launchctl bootstrap system $(plist_for "$l")"; return 0; fi
  priv "$LAUNCHCTL" bootout "system/$l" >/dev/null 2>&1 || true
  priv "$LAUNCHCTL" bootstrap system "$(plist_for "$l")" || die "launchd would not load $l; read: log show --last 5m --predicate 'process == \"launchd\"'"
  priv "$LAUNCHCTL" enable "system/$l" >/dev/null 2>&1 || true
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
  if [ "$DRY" = 1 ]; then say "would start the server: vyre-server start (docker compose up -d), then load the run.vyre.server job"; return 0; fi
  "$DIR/current/bin/vyre-server" start || die "the server did not start; read: vyre-server logs"
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
    say "It starts again by itself after a restart, even with nobody signed in. FileVault asks for a password at the start-up screen after a restart; that is what keeps the data encrypted."
    say "Go back to the Vyre app to finish setting up this server."
    say "Check it any time with: vyre-server doctor"
  fi
  say ""
}

uninstall() {
  [ -d "$DIR" ] || die "nothing is installed at $DIR."
  if [ "$PURGE" = 1 ] && ! ask "Delete the Space's data, every backup and the tools under $DIR? This cannot be undone."; then die "not purged."; fi
  runtime_env
  for l in $LABELS; do
    p=$(plist_for "$l")
    [ -f "$p" ] || continue
    grep -q "$MARK" "$p" || { say "  $p was not written by this installer; left alone."; continue; }
    priv "$LAUNCHCTL" bootout "system/$l" >/dev/null 2>&1 || true
    priv rm -f "$p"
  done
  if [ -x "$DIR/current/bin/vyre-server" ]; then run "$DIR/current/bin/vyre-server" stop || true; fi
  if [ -f "$BIN_DIR/vyre-server" ] && grep -q "$MARK" "$BIN_DIR/vyre-server"; then priv rm -f "$BIN_DIR/vyre-server"; fi
  if [ "$PURGE" = 1 ]; then
    d=$(cat "$DIR/data-dir" 2>/dev/null || printf '%s' "$DATA_DIR")
    if [ "$(cat "$DIR/runtime" 2>/dev/null || printf colima)" = colima ] && [ -x "$DIR/tools/bin/colima" ]; then run "$DIR/tools/bin/colima" delete --force || true; fi
    run rm -rf "$HOME/.colima/_lima/_config/override.yaml"
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
  case "$(uname -s)" in Darwin) ;; *) [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "this installer is for macOS; on Linux use the Linux installer." ;; esac
  cpu >/dev/null
  [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ "${VYRE_TEST_ROOT_OK:-0}" = 1 ] || [ "$(id -u)" != 0 ] || die "run this as your own account, not as root: it asks for your password when it needs it."
  if [ "$UNINSTALL" = 1 ]; then uninstall; return 0; fi
  say "Installing Vyre Server on this Mac. It checks the download against Vyre's signature before installing anything."
  need_tools
  check_macos
  check_encrypted "$DATA_DIR"
  check_space "$DATA_DIR"
  choose_runtime
  install_node
  fetch_release
  [ "$RUNTIME" != colima ] || install_colima
  unpack_release
  [ "$RUNTIME" != colima ] || write_colima_size
  write_lima_forwards
  write_config
  runtime_env
  link_current
  write_units
  [ "$RUNTIME" != colima ] || load_job run.vyre.colima
  wait_docker
  pull_images
  start_stack
  load_job run.vyre.server
  load_job run.vyre.server-update
  wait_green
  finish
}

if [ "${VYRE_SOURCE_ONLY:-0}" != 1 ]; then main "$@"; fi
