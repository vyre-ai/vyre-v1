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
#   --data-dir DIR     where the Space's data lives (default $VYRE_DIR/data); must be on an encrypted volume unless you choose one of the three below
#   --encrypt-data     make an encrypted (LUKS) volume for the data directory: a file ($VYRE_DIR/data.luks, --encrypt-size GB, default 20) or --encrypt-device /dev/xxx.
#                      You type a passphrase (needed again after every restart: vyre-server unlock) or give --key-file PATH on another volume.
#   --provider-encrypted   your word that the volume is encrypted at rest by your cloud provider (this server cannot see that); recorded
#   --allow-plain-disk     install on a plain disk anyway; recorded, and doctor and the Console warn that the data is not encrypted at rest
#   --role compute     with --server ADDRESS and VYRE_JOIN=<code>: add this machine to your Space as a server (agent computers run here)
#   --uninstall        stop the server, remove the units and /usr/local/bin/vyre-server; data and backups stay
#   --purge            with --uninstall: also delete the data and backups, after asking
#
# Environment: VYRE_DIR (default /srv/vyre), VYRE_UPDATE_URL (default: the signed release feed on GitHub, for the channel), VYRE_CODE (the one-time setup
# code the Vyre app makes when a server is added, for the install line `curl -fsSL https://vyre.run/install.sh | VYRE_CODE=... sh`;
# it is written only to $VYRE_DIR/vyre.env at mode 0600 and is never printed or taken as an argument).
#
# What it does, in order, and stops at the first thing that is wrong:
#   1. checks the machine: Linux, root, curl/tar/sha256sum/openssl/jq, 10 GB free, and that the data directory sits on an ENCRYPTED volume
#      (LUKS or dm-crypt, an encrypted ZFS dataset, or ecryptfs). Without one it refuses and shows three ways forward; the choice is yours and is recorded.
#   2. installs Docker Engine and the Compose plugin from Docker's signed apt repository on Debian and Ubuntu when they are missing (the repository key's fingerprint is checked).
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
ENCRYPT=0
ENCRYPT_DEVICE=""
ENCRYPT_SIZE_GB=20
KEY_FILE_ARG=""
ALLOW_PLAIN=0
PROVIDER_ENC=0
ENC_KIND=""
NETWORK_CHANGED=0
PASS=""
ROLE=space
SERVER_ARG=""
JOIN_ARG=${VYRE_JOIN:-}
TMP=""

DIR=${VYRE_DIR:-/srv/vyre}
UPDATE_URL=${VYRE_UPDATE_URL:-}   # empty until parse_args knows the channel
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

# The signed release feed of a channel, as scripts/release/feed.ts writes it: stable is the newest published release, beta and nightly are rolling releases with a fixed tag.
default_feed() {
  case "$1" in
    stable) printf 'https://github.com/vyre-ai/vyre-v1/releases/latest/download/' ;;
    *) printf 'https://github.com/vyre-ai/vyre-v1/releases/download/channel-%s/' "$1" ;;
  esac
}

usage() { sed -n '2,20p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

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
      --encrypt-data) ENCRYPT=1 ;;
      --encrypt-device) shift; [ $# -gt 0 ] || die "--encrypt-device needs a value"; ENCRYPT=1; ENCRYPT_DEVICE=$1 ;;
      --encrypt-size) shift; [ $# -gt 0 ] || die "--encrypt-size needs a number of GB"; ENCRYPT_SIZE_GB=$1 ;;
      --key-file) shift; [ $# -gt 0 ] || die "--key-file needs a path"; KEY_FILE_ARG=$1 ;;
      --provider-encrypted) PROVIDER_ENC=1 ;;
      --allow-plain-disk) ALLOW_PLAIN=1 ;;
      --role) shift; [ $# -gt 0 ] || die "--role needs a value"; ROLE=$1 ;;
      --server) shift; [ $# -gt 0 ] || die "--server needs a value"; SERVER_ARG=$1 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option $1 (see --help)" 2 ;;
    esac
    shift
  done
  case "$CHANNEL" in stable|beta|nightly) ;; *) die "--channel is stable, beta or nightly" 2 ;; esac
  if [ -n "$DOMAIN" ] && [ -n "$RELAY" ]; then die "--domain and --relay are two ways to reach this server; choose one" 2; fi
  case "$DOMAIN" in ""|*[!A-Za-z0-9.-]*) [ -z "$DOMAIN" ] || die "--domain must be a host name like vyre.example.com" 2 ;; esac
  case "$ENCRYPT_SIZE_GB" in ""|*[!0-9]*) die "--encrypt-size is a whole number of GB" 2 ;; esac
  [ "$ENCRYPT_SIZE_GB" -ge 5 ] || die "--encrypt-size must be at least 5 GB" 2
  [ "$ENCRYPT" = 1 ] || [ -z "$KEY_FILE_ARG" ] || die "--key-file goes with --encrypt-data" 2
  [ $((ENCRYPT + ALLOW_PLAIN + PROVIDER_ENC)) -le 1 ] || die "--encrypt-data, --provider-encrypted and --allow-plain-disk are three different answers to the disk question; choose one" 2
  node_check_args
  # a machine that joins someone else's Space keeps its own small folder, apart from any server's
  if [ "$ROLE" = compute ] && [ -z "${VYRE_DIR:-}" ]; then DIR=/srv/vyre-node; fi
  DATA_DIR=${DATA_DIR_ARG:-${VYRE_DATA_DIR:-$DIR/data}}
  [ -n "$UPDATE_URL" ] || UPDATE_URL=$(default_feed "$CHANNEL")
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

# What this installer remembered about the disk question on an earlier run (state/encryption: kind=luks|provider|plain|detected).
enc_file() { printf '%s/state/encryption' "$DIR"; }
enc_prior() { sed -n 's/^kind=//p' "$(enc_file)" 2>/dev/null | head -n 1; }

# fs_device PATH: the device the folder holding PATH sits on (the first column of df), for "is this key on the same disk as the data".
fs_device() {
  _p=$1
  if [ "${VYRE_TEST_MODE:-0}" = 1 ] && [ -n "${VYRE_TEST_FS_DEVICE:-}" ]; then
    printf '%s' "$VYRE_TEST_FS_DEVICE" | tr ',' '\n' | awk -F= -v p="$_p" 'index(p, $1) == 1 { print $2; exit }'
    return 0
  fi
  while [ ! -e "$_p" ]; do _p=$(dirname "$_p"); done
  df -P "$_p" 2>/dev/null | awk 'NR==2 {print $1}'
}

refuse_plain_disk() {
  d=$1; rc=$2
  printf 'vyre: the data directory %s is not on an encrypted volume%s.\n' "$d" "$([ "$rc" = 2 ] && printf ' that this installer can verify')" >&2
  cat >&2 <<EOT

Vyre keeps your Space's data, keys and backups there, so by default it will not install onto a plain disk.
Choose one of these, then run the installer again:

  1. Use your cloud provider's encrypted volume (the usual choice on a cloud server).
     Attach an encrypted volume at your provider and mount it, then add:  --data-dir <its folder> --provider-encrypted
     This server cannot see the provider's encryption from the inside, so --provider-encrypted is your word that it is on. Vyre records that.
     Which providers do this, and how: docs/getting-started.md, "Encrypting the data disk".

  2. Let this installer make an encrypted volume:  --encrypt-data
     It makes a LUKS volume of $ENCRYPT_SIZE_GB GB for the data directory (change it with --encrypt-size GB, or give a spare disk with --encrypt-device /dev/xxx).
     You type a passphrase, and type it again after every restart (vyre-server unlock). Or keep the key on another volume with --key-file PATH.
     This protects a copy of the disk, a snapshot or a stolen drive. It does not protect against someone who can log in to this server while it runs.

  3. Install on the plain disk anyway:  --allow-plain-disk
     Vyre records your choice. vyre-server doctor and the Console then say, every time, that the data is not encrypted at rest.
EOT
  exit 3
}

plain_notice() {
  say "  !!  the data directory $1 is on a plain disk. You chose that: the Space's data is NOT encrypted at rest."
  say "      Anyone who gets a copy of this disk, a snapshot or a backup can read it. vyre-server doctor and the Console will keep saying so."
}

# prompt_passphrase: sets PASS from the terminal (typed twice, or made for you), never from an argument or the environment. Needs a terminal.
prompt_passphrase() {
  (: </dev/tty) 2>/dev/null || die "the volume needs a passphrase and there is no terminal to ask on. Download the installer and run it from a terminal (curl -fsSLO <the install.sh address>, then sudo sh install.sh --encrypt-data ...), or give --key-file PATH." 2
  printf 'Choose a passphrase for the data volume (press Enter to have one made for you): ' >/dev/tty
  stty -echo </dev/tty 2>/dev/null || true
  read -r PASS </dev/tty || PASS=""
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  if [ -z "$PASS" ]; then
    PASS=$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)
    printf 'Your passphrase is:  %s\nWrite it down or put it in a password manager now. It is not stored on this server and is not shown again; without it the data cannot be opened.\n' "$PASS" >/dev/tty
    printf 'Type it again to confirm you have it: ' >/dev/tty
  else
    printf 'Type it again: ' >/dev/tty
  fi
  stty -echo </dev/tty 2>/dev/null || true
  read -r again </dev/tty || again=""
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  [ "$PASS" = "$again" ] || die "the two did not match; nothing was changed."
  [ "${#PASS}" -ge 8 ] || die "use at least 8 characters; nothing was changed."
}

# encrypt_data DIR: make a LUKS volume (a file, or the device given), format it, mount it on DIR, and remember how to open it (state/crypt.env). The key is never written anywhere by this installer
# unless --key-file names a file on another volume; a key on this same disk would protect nothing, so that is refused.
encrypt_data() {
  d=$1
  if [ "$DRY" = 1 ]; then
    say "would make an encrypted (LUKS) volume ${ENCRYPT_DEVICE:-of $ENCRYPT_SIZE_GB GB in $DIR/data.luks} and mount it on $d"
    ENC_KIND=luks
    return 0
  fi
  if ! command -v cryptsetup >/dev/null 2>&1; then
    say "  Installing cryptsetup (the tool that makes the encrypted volume)."
    apt_install cryptsetup || die "cryptsetup is not installed and could not be added. Install it (apt-get install cryptsetup) and run this installer again."
  fi
  if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then die "$d already holds files on the plain disk; move them away first (an encrypted volume would hide them). Nothing was changed."; fi
  mkdir -p "$DIR/state"
  if [ -n "$ENCRYPT_DEVICE" ]; then
    [ -b "$ENCRYPT_DEVICE" ] || [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "$ENCRYPT_DEVICE is not a disk or partition on this machine."
    target=$ENCRYPT_DEVICE
    say "  This will ERASE everything on $target."
    ask "Erase $target and use it for Vyre's data?" || die "not changed. (Run it from a terminal, or add --yes to confirm.)"
  else
    target=$DIR/data.luks
    [ ! -e "$target" ] || die "$target already exists; it may hold an earlier volume. Move it away or open it yourself. Nothing was changed."
    probe=$DIR; while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
    free_gb=$(( $(df -Pm "$probe" 2>/dev/null | awk 'NR==2 {print $4}') / 1024 ))
    [ "${free_gb:-0}" -ge $((ENCRYPT_SIZE_GB + 5)) ] || die "the volume needs $ENCRYPT_SIZE_GB GB and this disk has $free_gb GB free (it also needs room for the images). Choose a smaller --encrypt-size, or free space."
  fi
  keyfile=""
  if [ -n "$KEY_FILE_ARG" ]; then
    keyfile=$KEY_FILE_ARG
    kd=$(dirname "$keyfile")
    [ -d "$kd" ] || die "the folder for the key file, $kd, does not exist."
    if [ "$(fs_device "$kd")" = "$(fs_device "$DIR")" ]; then
      die "$keyfile is on the same disk as Vyre's data. A key kept beside the data it opens protects nothing. Put it on another volume (a separate disk, a USB drive, a network mount) and give that path. Nothing was changed."
    fi
    if [ ! -f "$keyfile" ]; then
      ( umask 077; openssl rand -base64 48 >"$keyfile" ) || die "could not write $keyfile."
      say "  Made a new key file: $keyfile. Keep a copy somewhere safe: without it the data cannot be opened."
    fi
  else
    prompt_passphrase
  fi
  say "  Making the encrypted volume (this changes nothing but $target)."
  if [ -z "$ENCRYPT_DEVICE" ]; then
    fallocate -l "${ENCRYPT_SIZE_GB}G" "$target" 2>/dev/null || dd if=/dev/zero of="$target" bs=1M count=$((ENCRYPT_SIZE_GB * 1024)) status=none || die "could not make $target."
    chmod 0600 "$target"
  fi
  if [ -n "$keyfile" ]; then
    cryptsetup luksFormat --batch-mode --type luks2 --key-file "$keyfile" "$target" || die "cryptsetup could not format $target."
    cryptsetup open --key-file "$keyfile" "$target" vyre-data || die "cryptsetup could not open $target."
  else
    printf '%s' "$PASS" | cryptsetup luksFormat --batch-mode --type luks2 --key-file=- "$target" || die "cryptsetup could not format $target."
    printf '%s' "$PASS" | cryptsetup open --key-file=- "$target" vyre-data || die "cryptsetup could not open $target."
  fi
  PASS=""
  mkfs.ext4 -q -L vyre-data /dev/mapper/vyre-data || die "could not make a file system on the encrypted volume."
  mkdir -p "$d"
  mount /dev/mapper/vyre-data "$d" || die "could not mount the encrypted volume on $d."
  printf 'CRYPT_TARGET=%s\nCRYPT_NAME=vyre-data\nCRYPT_MOUNT=%s\nCRYPT_KEYFILE=%s\n' "$target" "$d" "$keyfile" >"$DIR/state/crypt.env"
  ENC_KIND=luks
  say "  ok  the data directory $d is on an encrypted (LUKS) volume made by this installer"
  say ""
  say "  What this protects, and what it does not:"
  say "    - It protects a copy of this disk: a snapshot, a stolen or recycled drive, a backup of the disk."
  say "    - It does not protect against someone who can log in to this server while it runs: the volume is open then."
  if [ -n "$keyfile" ]; then
    say "    - The key is the file $keyfile on another volume. After a restart the server opens the data by itself only while that volume is mounted;"
    say "      otherwise run: sudo vyre-server unlock --key-file <path>"
  else
    say "    - The passphrase is not stored on this server. After every restart the Space stays closed until you run: sudo vyre-server unlock"
    say "      (so a restart, or an update that restarts the machine, needs a person)."
  fi
  say ""
}

# The data directory must sit on an encrypted volume, or the person must choose how to go on (one of three ways, recorded). Refuse, with the three ways, when they have not.
check_encrypted() {
  d=$1
  probe=$d
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  disk_encrypted "$probe" && rc=0 || rc=$?
  prior=$(enc_prior)
  if [ "$rc" = 0 ]; then
    ENC_KIND=detected
    say "  ok  the data directory $d is on an encrypted volume"
    return 0
  fi
  if [ "$ENCRYPT" = 1 ]; then encrypt_data "$d"; return 0; fi
  if [ "$PROVIDER_ENC" = 1 ]; then
    ENC_KIND=provider
    say "  ok  you said the volume holding $d is encrypted at rest by your provider. This installer cannot check that from the inside; it is recorded as your statement."
    return 0
  fi
  if [ "$ALLOW_PLAIN" = 1 ]; then ENC_KIND=plain; plain_notice "$d"; return 0; fi
  case "$prior" in
    provider|plain) ENC_KIND=$prior; say "  ok  $d: your earlier choice stands ($prior); to change it, run the installer with another of the three disk options"; return 0 ;;
    luks) die "the encrypted volume for $d is not open. Run: sudo vyre-server unlock, then run this installer again." ;;
  esac
  refuse_plain_disk "$d" "$rc"
}

# ---- Docker -------------------------------------------------------------------------------------------------------------------------
compose_ok() {
  v=$(docker compose version --short 2>/dev/null | sed -n 's/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p')
  [ -n "$v" ] || return 1
  major=${v% *}
  minor=${v#* }
  [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 24 ]; }
}

# Docker's apt repository key (the fingerprint Docker publishes at https://docs.docker.com/engine/install/ubuntu/): the key file is checked against it before the repository is trusted.
DOCKER_KEY_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

# Docker Engine from Docker's own signed apt repository on Debian and Ubuntu. Anywhere else the person installs Docker and runs this again.
docker_apt_install() {
  osr=${VYRE_OS_RELEASE:-/etc/os-release}
  KEYRING_DIR=/etc/apt/keyrings; APT_LIST_DIR=/etc/apt/sources.list.d
  if [ "${VYRE_TEST_MODE:-0}" = 1 ]; then KEYRING_DIR=${VYRE_KEYRING_DIR:-$KEYRING_DIR}; APT_LIST_DIR=${VYRE_APT_LIST_DIR:-$APT_LIST_DIR}; fi
  [ -r "$osr" ] || return 1
  os_id=$(. "$osr"; printf '%s' "${ID:-}")
  case "$os_id" in ubuntu|debian) ;; *) return 1 ;; esac
  command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1 || return 1
  os_code=$(. "$osr"; if [ "${ID:-}" = ubuntu ]; then printf '%s' "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"; else printf '%s' "${VERSION_CODENAME:-}"; fi)
  [ -n "$os_code" ] || return 1
  if [ "$DRY" = 1 ]; then say "would install Docker Engine and the Compose plugin from Docker's apt repository for $os_id $os_code (its key checked against Docker's published fingerprint)"; return 0; fi
  say "  Docker is not installed. Installing Docker Engine and the Compose plugin from Docker's own apt repository (about a minute)."
  export DEBIAN_FRONTEND=noninteractive
  {
    apt-get update -y && apt-get install -y ca-certificates curl gnupg \
      && install -m 0755 -d "$KEYRING_DIR" \
      && curl -fsSL "https://download.docker.com/linux/$os_id/gpg" -o "$KEYRING_DIR/docker.asc" \
      && chmod a+r "$KEYRING_DIR/docker.asc"
  } >"$TMP/docker-install.log" 2>&1 || die "Docker did not install. Its own output is in $TMP/docker-install.log (kept); after fixing that, run this installer again."
  fpr=$(gpg --show-keys --with-colons "$KEYRING_DIR/docker.asc" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')
  if [ "$fpr" != "$DOCKER_KEY_FPR" ]; then rm -f "$KEYRING_DIR/docker.asc"; die "the Docker repository key is not the one Docker publishes (got ${fpr:-nothing}); nothing was installed."; fi
  say "  ok  Docker's repository key matches the fingerprint Docker publishes"
  {
    printf 'deb [arch=%s signed-by=%s/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$KEYRING_DIR" "$os_id" "$os_code" >"$APT_LIST_DIR/docker.list" \
      && apt-get update -y \
      && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  } >>"$TMP/docker-install.log" 2>&1 || die "Docker did not install. Its own output is in $TMP/docker-install.log (kept); after fixing that, run this installer again."
  command -v systemctl >/dev/null 2>&1 && systemctl enable --now docker >/dev/null 2>&1 || true
  return 0
}

need_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    if docker_apt_install; then
      [ "$DRY" = 1 ] && return 0
    else
      say "Vyre Server runs in Docker, and this installer adds it only on Debian and Ubuntu. Install Docker Engine and the Compose plugin (https://docs.docker.com/engine/install/), then run this installer again."
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
MCowBQYDK2VwAyEAoh2/Z+k+ZXGNRVKYlkVeE6TLKWt3+HK3rxm6gbCU6Po=
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

# access_words ADDRESS RELAY: how a server is reached, in a few plain words.
access_words() { if [ -n "$1" ]; then printf 'your own name, https://%s' "$1"; elif [ -n "$2" ]; then printf "Vyre's relay (%s)" "$2"; else printf 'no way set yet'; fi; }

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
    # a server for a Personal Space (Settings, Computers, Add a server): VYRE_PEER_JOIN is the one-time code; the server joins through the relay, needs no address and holds a full copy
    if [ -n "${VYRE_PEER_JOIN:-}" ]; then printf 'VYRE_SPACE_KIND=personal\nVYRE_PEERS=1\nVYRE_PEER_KIND=server\nVYRE_PEER_JOIN=%s\n' "$VYRE_PEER_JOIN" >>"$DIR/vyre.env"; fi
  fi
  # How this server is reached: what the flags say, else what the earlier install had. Changing it on an existing install is said out loud and applied (the server is recreated below).
  old_addr=$(sed -n 's/^VYRE_ADDRESS=//p' "$DIR/compose.env" 2>/dev/null | head -n 1)
  old_relay=$(sed -n 's/^VYRE_RELAY_URL=//p' "$DIR/compose.env" 2>/dev/null | head -n 1)
  old_rev=$(sed -n 's/^VYRE_NETWORK_REV=//p' "$DIR/compose.env" 2>/dev/null | head -n 1)
  if [ -z "$DOMAIN$RELAY" ]; then DOMAIN=$old_addr; RELAY=$old_relay; fi
  rev=$old_rev
  if [ -f "$DIR/compose.env" ] && { [ "$DOMAIN" != "$old_addr" ] || [ "$RELAY" != "$old_relay" ]; }; then
    NETWORK_CHANGED=1
    rev=$(date +%s)
    say "  Changing how this server is reached: from $(access_words "$old_addr" "$old_relay") to $(access_words "$DOMAIN" "$RELAY"). The Space's data is kept."
  fi
  # compose.env: what the compose file reads. Rewritten each install from the release and the choices made here.
  {
    printf 'VYRE_IMAGE=%s\n' "$(lock_get VYRE_IMAGE)"
    # the agent computer image of this release, by digest: vyred asks for exactly this one
    [ -z "$(lock_get VYRE_AGENT_IMAGE)" ] || printf 'VYRE_AGENT_COMPUTER_IMAGE=%s\n' "$(lock_get VYRE_AGENT_IMAGE)"
    # the Space browser image of this release, by digest (images/space-browser)
    [ -z "$(lock_get VYRE_BROWSER_IMAGE)" ] || printf 'VYRE_SPACE_BROWSER_IMAGE=%s\n' "$(lock_get VYRE_BROWSER_IMAGE)"
    # the agent workspace image of this release, by digest, the same way
    [ -z "$(lock_get VYRE_WORKSPACE_IMAGE)" ] || printf 'VYRE_WORKSPACE_IMAGE=%s\n' "$(lock_get VYRE_WORKSPACE_IMAGE)"
    printf 'VYRE_PORT=8420\n'
    printf 'VYRE_SPACE=%s\n' "$(space_id)"
    [ -z "$DOMAIN" ] || printf 'VYRE_ADDRESS=%s\n' "$DOMAIN"
    [ -z "$RELAY" ] || printf 'VYRE_RELAY_URL=%s\n' "$RELAY"
    [ -z "$rev" ] || printf 'VYRE_NETWORK_REV=%s\n' "$rev"
    # without a domain no port is opened to the internet: 80 and 443 stay on this machine's own loopback address
    [ -n "$DOMAIN" ] || printf 'VYRE_BIND=127.0.0.1\n'
    # what was chosen about disk encryption, for the Console's health page (the server inside Docker cannot see the host's disk)
    kind=${ENC_KIND:-$(enc_prior)}
    if [ -n "$kind" ]; then printf 'VYRE_DISK_ENCRYPTION=%s\nVYRE_DISK_ENCRYPTION_SINCE=%s\n' "$kind" "$(sed -n 's/^since=//p' "$(enc_file)" 2>/dev/null | head -n 1 | grep . || date -u +%Y-%m-%d)"; fi
  } >"$DIR/compose.env.new"
  mv "$DIR/compose.env.new" "$DIR/compose.env"
  # the disk choice, written down: a standing fact doctor and the Console read
  if [ -n "${ENC_KIND:-}" ] && [ "$ENC_KIND" != "$(enc_prior)" ]; then printf 'kind=%s\nsince=%s\n' "$ENC_KIND" "$(date -u +%Y-%m-%d)" >"$(enc_file)"; fi
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

# userns_setting: Ubuntu 24.04 blocks the user namespaces the engine sandbox needs; the release's own script writes /etc/sysctl.d/60-vyre-userns.conf where the kernel has the setting.
userns_setting() {
  if [ "$DRY" = 1 ]; then say "would write /etc/sysctl.d/60-vyre-userns.conf (kernel.apparmor_restrict_unprivileged_userns=0) where the kernel has that setting"; return 0; fi
  [ "${VYRE_TEST_MODE:-0}" != 1 ] || [ -n "${VYRE_SYSCTL_DIR:-}" ] || return 0
  VYRE_DIR="$DIR" sh "$DIR/current/bin/vyre-server" fix-userns >/dev/null 2>&1 || true
}

pull_images() {
  for k in VYRE_IMAGE VYRE_AGENT_IMAGE VYRE_BROWSER_IMAGE VYRE_WORKSPACE_IMAGE VYRE_SANDBOX_IMAGE; do
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
  fi
  # `up -d` recreates a container whose settings changed (a new address, a new release) and leaves the rest; a plain unit start does nothing when the server already runs
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

# public_address: this machine's address as the internet sees it, or nothing.
public_address() {
  if [ "${VYRE_TEST_MODE:-0}" = 1 ]; then printf '%s' "${VYRE_TEST_PUBLIC_IP:-}"; return 0; fi
  for u in https://api.ipify.org https://ifconfig.me/ip; do
    a=$(curl -fsS --max-time 5 "$u" 2>/dev/null | tr -d ' \r\n') && [ -n "$a" ] && { printf '%s' "$a"; return 0; }
  done
  return 0
}

# resolve_a NAME: the first IPv4 address NAME resolves to, or nothing.
resolve_a() {
  if [ "${VYRE_TEST_MODE:-0}" = 1 ]; then [ -z "${VYRE_TEST_RESOLVE:-}" ] || awk -v n="$1" '$1 == n { print $2; exit }' "$VYRE_TEST_RESOLVE"; return 0; fi
  getent ahostsv4 "$1" 2>/dev/null | awk 'NR == 1 { print $1 }'
}

# dns_lines NAME: what the name needs, one short line each, checked against this machine's address. Says which one is wrong.
dns_lines() {
  _n=$1
  mine=$(public_address)
  say "  Before people can open https://$_n, your DNS and firewall need three things:"
  say "    1. An A record for $_n that points to this machine${mine:+ ($mine)}."
  say "    2. An A record for a.$_n that points to the same address (artifacts open there)."
  say "    3. Ports 80 and 443 open to the internet (in the provider's firewall too). The certificate is fetched over port 80."
  [ -z "${VYRE_TEST_MODE:-}" ] || [ "${VYRE_TEST_MODE:-0}" != 1 ] || [ -n "${VYRE_TEST_PUBLIC_IP:-}" ] || return 0
  if [ -z "$mine" ]; then say "  This machine's public address could not be read, so the records are not checked here."; return 0; fi
  for _h in "$_n" "a.$_n"; do
    got=$(resolve_a "$_h")
    if [ -z "$got" ]; then say "  !!  $_h has no A record yet. Create one that points to $mine."
    elif [ "$got" != "$mine" ]; then say "  !!  $_h points to $got, but this machine is $mine. Change the record to $mine."
    else say "  ok  $_h points to this machine ($mine)"
    fi
  done
}

# relay_words: what the relay is, and is not, for a server installed without the app's install line.
relay_words() {
  say "It connects outward to $RELAY. No port is open to the internet on this machine."
  say ""
  if grep -q '^VYRE_SETUP_CODE=' "$DIR/vyre.env" 2>/dev/null; then
    say "This server was installed with a one-time code from the Vyre app. Go back to the app: it finds this server and finishes the setup."
  else
    say "A server reached through the relay has no web address that a browser can open. The relay finds it only for the Vyre app (Mac or Windows) that made its install line."
    say "  - With the Vyre app: in the app choose Create a Space, then Team Space, then add a server. The app shows an install line with a one-time code. Run that line here, then carry on in the app."
    say "  - With only a browser: install with your own name instead: run this installer again with --domain vyre.example.com (docs/getting-started.md, \"A name for your server\")."
  fi
}

finish() {
  say ""
  if [ "$DRY" = 1 ]; then
    say "That is the whole plan. Nothing on this machine changed. Run it again without --dry-run when you are ready."
  else
    say "Vyre Server $REL_VERSION is running."
    if [ -n "$DOMAIN" ]; then say "Your Space will answer at https://$DOMAIN once the records below are right and its certificate is issued."
         dns_lines "$DOMAIN"
    elif [ -n "$RELAY" ]; then relay_words
    else say "Choose how people reach it: run the installer again with --domain NAME or --relay."
    fi
    case "${ENC_KIND:-$(enc_prior)}" in
      plain) say ""; say "Reminder: the data is NOT encrypted at rest (you chose --allow-plain-disk). vyre-server doctor says so until that changes." ;;
      provider) say ""; say "The data volume's encryption is your provider's, as you said. This server cannot check it." ;;
    esac
    # the link itself is a credential and stays out of this output (it can end up in a provisioning log): the owner asks for it
    if [ -f "$DATA_DIR/space/logs/claim-link.txt" ]; then say ""; say "To claim this Space as its owner, run: sudo vyre-server claim-link and open the link it prints (once, within 24 hours)."; fi
    say "Check it any time with: vyre-server doctor"
  fi
  say ""
}

uninstall() {
  [ -d "$DIR" ] || die "nothing is installed at $DIR."
  if [ "$PURGE" = 1 ] && ! ask "Delete the Space's data and every backup under $DIR? This cannot be undone."; then
    if (: </dev/tty) 2>/dev/null; then die "not purged: you did not answer yes. Nothing was removed."; fi
    die "not purged, and nothing was removed: this installer cannot ask you to confirm because it is reading from a pipe. To confirm, add --yes:  ... | sudo sh -s -- --uninstall --purge --yes"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    run systemctl disable --now vyre-server-update.timer || true
    run systemctl disable --now vyre-server.service || true
  fi
  if [ -x "$DIR/current/bin/vyre-server" ]; then run "$DIR/current/bin/vyre-server" stop || true; fi
  # Remove the containers while the release's compose file still exists (once the releases are gone nothing can name them); --purge also drops the volumes.
  if [ -f "$DIR/current/compose.server.yml" ] && [ -f "$DIR/compose.env" ] && command -v docker >/dev/null 2>&1; then
    down_flags="--remove-orphans"; [ "$PURGE" != 1 ] || down_flags="-v --remove-orphans"
    # shellcheck disable=SC2086
    run docker compose --project-directory "$DIR/current" --env-file "$DIR/compose.env" -f "$DIR/current/compose.server.yml" -f "$DIR/compose.override.yml" down $down_flags || true
  fi
  # A purge after an earlier plain uninstall has no compose file left: find what is left by the compose project label.
  if [ "$PURGE" = 1 ] && [ "$DRY" != 1 ] && command -v docker >/dev/null 2>&1; then
    proj=${COMPOSE_PROJECT_NAME:-vyre-server}
    for c in $(docker ps -aq --filter "label=com.docker.compose.project=$proj" 2>/dev/null); do docker rm -f "$c" >/dev/null 2>&1 || true; done
    for v in $(docker volume ls -q --filter "label=com.docker.compose.project=$proj" 2>/dev/null); do docker volume rm -f "$v" >/dev/null 2>&1 || true; done
  fi
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

node_own_data() { chown 1000:1000 "$DIR/data" 2>/dev/null || [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "could not give the data folder to the server's user (uid 1000)."; }

# ---- the compute role (identical in both installers; the test compares the two copies) ----------------------------------------------
# BEGIN node
# `--role compute --server ADDRESS` with VYRE_JOIN=<the one-time code> in the environment makes this machine a server of someone's Space: it holds no Space data, only its own key and the
# credential the Space hands it after a person approves it. It runs the release's vyred image with --role compute and the Docker socket, so agent computers can run here. The same signed
# manifest and checksum checks as the server install run first (fetch_release); the join code is read from the environment, written only to node.env at mode 0600, and removed once the
# machine has joined. Docker restarts the container (restart: unless-stopped), so there is no unit of our own.
NODE_JOIN_RE='^VYRE-[A-Z2-9]{4}-[A-Z2-9]{4}$'

# node_check_args: what --role, --server and the join code must look like. Called once the flags are read.
node_check_args() {
  case "$ROLE" in space|compute) ;; *) die "--role is space or compute" 2 ;; esac
  if [ "$ROLE" != compute ]; then
    [ -z "$SERVER_ARG" ] || die "--server is for --role compute (the address of the Space this machine joins)" 2
    return 0
  fi
  case "$SERVER_ARG" in
    http://?*|https://?*) ;;
    *) die "--role compute needs --server <the address of your Space>, like https://home.example.com" 2 ;;
  esac
  case "$SERVER_ARG" in *[!A-Za-z0-9_@%+=:,./~?-]*) die "--server holds a character that is not part of an address" 2 ;; esac
  if [ -n "$JOIN_ARG" ]; then
    printf '%s' "$JOIN_ARG" | grep -Eq "$NODE_JOIN_RE" || die "the join code looks like VYRE-ABCD-2345; copy it again from the Add a server sheet" 2
  fi
  [ -z "$DOMAIN$RELAY" ] || die "--domain and --relay are for a server that runs a Space, not for --role compute" 2
}

# node_need_code: a first install needs the code; a re-run on a machine that already joined does not.
node_need_code() {
  [ -n "$JOIN_ARG" ] && return 0
  [ -f "$DIR/data/compute-state.json" ] && return 0
  die "give the one-time join code: VYRE_JOIN=VYRE-ABCD-2345 in the environment of this command (make one in Vyre: Settings, Computers, Add a server)." 2
}

# The same Caddy the Space server runs (images/vyred/compose.server.yml); a test checks the two pins match.
CADDY_IMAGE=caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f

# node_ports_free: are 80 and 443 free here? Another web server on this machine keeps them, and this machine then simply serves no custom domain.
node_ports_free() {
  command -v ss >/dev/null 2>&1 || return 0
  [ -z "$(ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null)" ]
}

# node_write_config: node.env (0600), compose.env, compose.node.yml and Caddyfile, and the data folder the container's user (uid 1000) owns.
node_write_config() {
  if [ "$DRY" = 1 ]; then say "would write $DIR/node.env (0600), $DIR/compose.env, $DIR/compose.node.yml and $DIR/Caddyfile, and create $DIR/data"; return 0; fi
  mkdir -p "$DIR/data" "$DIR/state"
  chmod 0700 "$DIR/data"
  node_own_data
  ( umask 077; { printf 'VYRE_ROLE=compute\nVYRE_SERVER=%s\n' "$SERVER_ARG"; [ -z "$JOIN_ARG" ] || printf 'VYRE_JOIN=%s\n' "$JOIN_ARG"; } >"$DIR/node.env.new" )
  chmod 0600 "$DIR/node.env.new"
  mv "$DIR/node.env.new" "$DIR/node.env"
  gid=$(stat -c %g /var/run/docker.sock 2>/dev/null || stat -f %g /var/run/docker.sock 2>/dev/null || printf '0')
  NODE_PORTS='      - "80:80"
      - "443:443"'
  # a running Vyre keeps its own ports through a re-run
  if ! node_ports_free && ! grep -q '"443:443"' "$DIR/compose.node.yml" 2>/dev/null; then
    say "  Ports 80 and 443 are in use here, so this machine will serve no custom domains. Everything else works."
    NODE_PORTS='      - "127.0.0.1:0:80"'
  fi
  {
    printf 'VYRE_IMAGE=%s\n' "$(lock_get VYRE_IMAGE)"
    printf 'VYRE_AGENT_IMAGE=%s\n' "$(lock_get VYRE_AGENT_IMAGE)"
    printf 'VYRE_BROWSER_IMAGE=%s\n' "$(lock_get VYRE_BROWSER_IMAGE)"
    printf 'VYRE_WORKSPACE_IMAGE=%s\n' "$(lock_get VYRE_WORKSPACE_IMAGE)"
    printf 'DOCKER_GID=%s\n' "$gid"
  } >"$DIR/compose.env"
  cat >"$DIR/compose.node.yml" <<COMPOSE
# $MARK (compute role). The Space this machine joined is in node.env; the Docker socket is how agent computers run here.
name: vyre-node
services:
  vyred:
    image: \${VYRE_IMAGE}
    restart: unless-stopped
    command: ["node", "/opt/vyre/host/src/daemon/main.ts", "--role", "compute"]
    env_file:
      - ./node.env
    # bridge: the network agent computers are on, so Caddy (which shares this network namespace) reaches a site on a computer here. vyred in compute role listens on nothing.
    network_mode: bridge
    environment:
      VYRE_AGENT_COMPUTER_IMAGE: \${VYRE_AGENT_IMAGE}
      VYRE_SPACE_BROWSER_IMAGE: \${VYRE_BROWSER_IMAGE}
      VYRE_WORKSPACE_IMAGE: \${VYRE_WORKSPACE_IMAGE}
      VYRE_CADDY_ADMIN: http://127.0.0.1:2019
    volumes:
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    group_add:
      - "\${DOCKER_GID}"
    ports:
$NODE_PORTS
    cap_drop: [ALL]
    # bubblewrap (the engine's sandbox) needs user namespaces and a readable /proc, which Docker's default profile withholds. This container already holds the Docker socket, which is root on this
    # machine, so these two add no reach the socket does not; the engine itself still runs inside bubblewrap with the network wall.
    security_opt:
      - no-new-privileges:true
      - seccomp=unconfined
      - systempaths=unconfined
  # Caddy, as on the Space server: a site's custom domain gets its route here and its certificate by ACME. It starts empty and keeps what vyred writes across a restart.
  caddy:
    image: $CADDY_IMAGE
    restart: unless-stopped
    network_mode: "service:vyred"
    depends_on:
      vyred:
        condition: service_started
    command: ["caddy", "run", "--resume", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/data:/data
      - ./caddy/config:/config
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt:
      - no-new-privileges:true
COMPOSE
  printf '{\n\tadmin 127.0.0.1:2019\n}\n' >"$DIR/Caddyfile"
  mkdir -p "$DIR/caddy/data" "$DIR/caddy/config"
  printf '%s\n' "$CHANNEL" >"$DIR/channel"
}

node_compose() { docker compose --project-directory "$DIR" --env-file "$DIR/compose.env" -f "$DIR/compose.node.yml" "$@"; }

node_start() {
  if [ "$DRY" = 1 ]; then say "would start the server: docker compose up -d in $DIR"; return 0; fi
  node_compose up -d || die "the server did not start; read: docker compose -f $DIR/compose.node.yml logs"
}

# node_wait_fingerprint: the machine prints the eight characters a person compares when they approve it; show them here too, then forget the one-time code.
node_wait_fingerprint() {
  [ "$DRY" = 1 ] && return 0
  say "  Waiting for this machine to ask to join (up to ${VYRE_UP_WAIT:-90} s)"
  n=0
  while [ "$n" -lt "${VYRE_UP_WAIT:-90}" ]; do
    fp=$(node_compose logs --no-color 2>/dev/null | grep -Eo 'Fingerprint [A-Z2-9]{4}-[A-Z2-9]{4}' | tail -n 1 | awk '{print $2}')
    if [ -n "$fp" ]; then
      NODE_FP=$fp
      if grep -q '^VYRE_JOIN=' "$DIR/node.env" 2>/dev/null; then
        ( umask 077; grep -v '^VYRE_JOIN=' "$DIR/node.env" >"$DIR/node.env.new" || true )
        chmod 0600 "$DIR/node.env.new"
        mv "$DIR/node.env.new" "$DIR/node.env"
      fi
      return 0
    fi
    [ -f "$DIR/data/compute-state.json" ] && { NODE_FP=""; return 0; }
    n=$((n + 3))
    sleep 3
  done
  die "this machine did not ask to join. Read: docker compose -f $DIR/compose.node.yml logs (is the Space address reachable from here, and is the code still valid? It lasts ten minutes)."
}

node_finish() {
  say ""
  if [ "$DRY" = 1 ]; then
    say "That is the whole plan. Nothing on this machine changed. Run it again without --dry-run when you are ready."
  else
    say "This machine asked to join your Space."
    [ -z "${NODE_FP:-}" ] || say "Fingerprint $NODE_FP. Compare it with the one in Vyre, then approve."
    say "Docker keeps it running, and starts it again after a restart. Remove it with: the same command and --uninstall."
  fi
  say ""
}

node_uninstall() {
  [ -d "$DIR" ] || die "nothing is installed at $DIR."
  if [ -f "$DIR/compose.node.yml" ] && command -v docker >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    run docker compose --project-directory "$DIR" --env-file "$DIR/compose.env" -f "$DIR/compose.node.yml" down --remove-orphans || true
  fi
  run rm -rf "$DIR"
  say "Removed this server. Remove it from Settings, Computers in Vyre too, so its access ends there."
}
# END node

# compute_main: add this machine to a Space as a server.
compute_main() {
  node_need_code
  say "Adding this machine to your Space as a server. It checks the download against Vyre's signature before installing anything."
  need_tools
  check_openssl
  MIN_FREE_MB=${VYRE_MIN_FREE_MB:-4096}
  check_space "$DIR"
  need_docker
  fetch_release
  unpack_release
  node_write_config
  pull_images
  node_start
  node_wait_fingerprint
  node_finish
}


main() {
  umask 022
  parse_args "$@"
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/vyre-install.XXXXXX")
  trap cleanup EXIT
  case "$(uname -s)" in Linux) ;; *) [ "${VYRE_TEST_MODE:-0}" = 1 ] || die "this installer is for Linux; on a Mac run: curl -fsSL https://vyre.run/install-mac.sh | sh" ;; esac
  case "$(uname -m)" in x86_64|amd64|aarch64|arm64) ;; *) die "Vyre Server runs on x86_64 and arm64; this machine is $(uname -m)." ;; esac
  is_root || die "run this as root (for example: curl -fsSL https://vyre.run/install.sh | sudo sh)."
  if [ "$UNINSTALL" = 1 ] && [ "$ROLE" = compute ]; then node_uninstall; return 0; fi
  if [ "$UNINSTALL" = 1 ]; then uninstall; return 0; fi
  if [ "$ROLE" = compute ]; then compute_main; return 0; fi
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
  userns_setting
  pull_images
  start_stack
  wait_green
  finish
}

if [ "${VYRE_SOURCE_ONLY:-0}" != 1 ]; then main "$@"; fi
