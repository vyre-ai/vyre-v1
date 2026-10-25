#!/bin/sh
# @heavy: the Linux installer on a fresh host with real Docker (P-L10_09, spec 3.13, ARCH 7.13).
#
# Builds a signed release of a stand-in server (busybox: an HTTP /healthz and a sleeping "caddy" sharing its network, the same compose shape
# as images/vyred/compose.server.yml), serves it from a file:// channel, then drives the real install.sh and the real vyre-server:
#   install refuses a plain disk, --dry-run changes nothing, a bad signature and a bad hash stop it, a real install ends with `doctor` green,
#   the setup code stays out of the output and is kept at mode 0600, a re-run keeps vyre.env, doctor goes red on a plain disk, update backs up
#   and switches, a manual rollback works, a release that never gets healthy is rolled back by update, uninstall keeps the data and --purge removes it.
# The machine itself is not touched: VYRE_DIR, the command folder and the systemd folder live in a temp directory, systemctl is a recorder and
# the "encrypted volume" answer comes from a fake /proc/mounts and lsblk (VYRE_TEST_MODE is how the scripts allow that).
#
# Runs only with VYRE_HEAVY_DOCKER=1 on a runner with Docker and OpenSSL 3 (otherwise it says it skipped, and a skip is not a pass).
# VYRE_COMPOSE_BIN names a standalone docker-compose when the machine has no compose plugin.
# Output: one "ok N - name" or "not ok N - name" line per check, then "# pass P fail F"; exit 1 when anything failed.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
if [ "${VYRE_HEAVY_DOCKER:-0}" != 1 ]; then
  echo "skipped: VYRE_HEAVY_DOCKER is not 1 (this check needs Docker)"
  exit 0
fi

REAL_DOCKER=$(command -v docker) || { echo "not ok 0 - docker is not installed" >&2; exit 1; }
W=$(mktemp -d "${TMPDIR:-/tmp}/vyre-install-heavy.XXXXXX")
PROJECT=vyreinst$$
BASE_IMAGE=${VYRE_HEAVY_BASE_IMAGE:-busybox:1.36.1}

cleanup() {
  if [ -d "$W/srv/current" ]; then COMPOSE_PROJECT_NAME=$PROJECT "$W/shim/docker" compose --project-directory "$W/srv/current" --env-file "$W/srv/compose.env" -f "$W/srv/current/compose.server.yml" -f "$W/srv/compose.override.yml" down -v --remove-orphans >/dev/null 2>&1 || true; fi
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | while read -r c; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | while read -r vol; do docker volume rm -f "$vol" >/dev/null 2>&1 || true; done
  rm -rf "$W"
}
trap cleanup EXIT

# ---- the fake machine ---------------------------------------------------------------------------------------------------------------
mkdir -p "$W/shim" "$W/bin" "$W/units" "$W/chan" "$W/stage"
printf '#!/bin/sh\nif [ "${1:-}" = compose ] && [ -n "${VYRE_COMPOSE_BIN:-}" ]; then shift; exec "$VYRE_COMPOSE_BIN" "$@"; fi\nexec "%s" "$@"\n' "$REAL_DOCKER" >"$W/shim/docker"
printf '#!/bin/sh\necho "systemctl $*" >>"%s/systemctl.log"\n' "$W" >"$W/shim/systemctl"
printf '#!/bin/sh\nprintf "crypt\\ndisk\\n"\n' >"$W/shim/lsblk-crypt"
printf '#!/bin/sh\nprintf "part\\ndisk\\n"\n' >"$W/shim/lsblk-plain"
chmod +x "$W/shim/docker" "$W/shim/systemctl" "$W/shim/lsblk-crypt" "$W/shim/lsblk-plain"
printf '/dev/sda1 / ext4 rw 0 0\n/dev/mapper/vyre-data %s ext4 rw 0 0\n' "$W" >"$W/mounts-crypt"
printf '/dev/sda1 / ext4 rw 0 0\n' >"$W/mounts-plain"
: >"$W/systemctl.log"

SHIM_PATH="$W/shim:$PATH"
PORT=8420
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q "[:.]$PORT "; then echo "not ok 0 - port $PORT is in use on this machine; the installer's fixed server port must be free" >&2; exit 1; fi

# ---- a signed channel ---------------------------------------------------------------------------------------------------------------
openssl genpkey -algorithm ed25519 -out "$W/release.key" 2>/dev/null
openssl pkey -in "$W/release.key" -pubout -out "$W/release.pub" 2>/dev/null
openssl genpkey -algorithm ed25519 -out "$W/other.key" 2>/dev/null

docker pull -q "$BASE_IMAGE" >/dev/null
IMG=$(docker image inspect --format '{{index .RepoDigests 0}}' "$BASE_IMAGE")
case "$IMG" in *@sha256:*) ;; *) echo "not ok 0 - $BASE_IMAGE has no registry digest ($IMG)" >&2; exit 1 ;; esac

# mkrel VERSION good|bad: a release tarball at $W/chan/vyre-server-VERSION.tgz. A "bad" one starts a server that never answers.
mkrel() {
  v=$1; kind=$2
  d=$W/stage/vyre-server-$v
  rm -rf "$d"; mkdir -p "$d/bin" "$d/units"
  printf '%s' "$v" >"$d/VERSION"
  printf '# stand-in Caddyfile\n' >"$d/Caddyfile"
  printf 'VYRE_IMAGE=%s\nVYRE_AGENT_IMAGE=%s\nVYRE_SANDBOX_IMAGE=%s\n' "$IMG" "$IMG" "$IMG" >"$d/images.lock"
  cp "$HERE/vyre-server" "$d/bin/vyre-server"
  cp "$HERE/units/"* "$d/units/"
  if [ "$kind" = good ]; then
    cmd='["sh","-c","mkdir -p /www && echo ok > /www/healthz && echo \"'"$v"'\" > /data/running-version && exec httpd -f -p 8420 -h /www"]'
    hc='["CMD","wget","-q","-O","-","http://127.0.0.1:8420/healthz"]'
  else
    cmd='["sh","-c","exec sleep 3600"]'
    hc='["CMD","false"]'
  fi
  cat >"$d/compose.server.yml" <<EOF
services:
  vyred:
    image: \${VYRE_IMAGE}
    command: $cmd
    healthcheck: { test: $hc, interval: 2s, timeout: 2s, retries: 2, start_period: 1s }
    ports: ["127.0.0.1:\${VYRE_PORT:-8420}:8420"]
    volumes: [ "vyre-data:/data", "vyre-work:/work" ]
  caddy:
    image: \${VYRE_IMAGE}
    network_mode: "service:vyred"
    command: ["sleep", "3600"]
    depends_on: { vyred: { condition: service_started } }
    volumes: [ "caddy-data:/cd", "caddy-config:/cc" ]
volumes:
  vyre-data:
  vyre-work:
  caddy-data:
  caddy-config:
EOF
  tar -czf "$W/chan/vyre-server-$v.tgz" -C "$W/stage" "vyre-server-$v"
}

# publish VERSION [KEY]: the stable channel's manifest naming that release, signed with KEY (default the release key).
publish() {
  v=$1; key=${2:-$W/release.key}
  sum=$(sha256sum "$W/chan/vyre-server-$v.tgz" | awk '{print $1}')
  printf '{"v":1,"channel":"stable","server":{"version":"%s","tarball":"vyre-server-%s.tgz","sha256":"%s"}}\n' "$v" "$v" "$sum" >"$W/chan/stable.json"
  { printf 'vyre-release-sums\n'; cat "$W/chan/stable.json"; } >"$W/signed.msg"
  openssl pkeyutl -sign -inkey "$key" -rawin -in "$W/signed.msg" -out "$W/sig.bin"
  openssl base64 -A -in "$W/sig.bin" >"$W/chan/stable.json.sig"
}

# ---- how every check runs the scripts ------------------------------------------------------------------------------------------------
envrun() {
  # envrun MOUNTS LSBLK CMD...
  m=$1; l=$2; shift 2
  env PATH="$SHIM_PATH" VYRE_TEST_MODE=1 VYRE_TEST_NONROOT=1 VYRE_DIR="$W/srv" VYRE_BIN_DIR="$W/bin" VYRE_SYSTEMD_DIR="$W/units" \
    VYRE_UPDATE_URL="file://$W/chan/" VYRE_RELEASE_KEY_PEM="$W/release.pub" VYRE_TEST_PROC_MOUNTS="$W/mounts-$m" VYRE_TEST_LSBLK="$W/shim/lsblk-$l" \
    VYRE_MIN_FREE_MB=100 VYRE_UP_WAIT=60 VYRE_TEST_HEALTH_URL="http://127.0.0.1:$PORT/healthz" COMPOSE_PROJECT_NAME=$PROJECT \
    "$@"
}
install_enc() { envrun crypt crypt sh "$HERE/install.sh" "$@"; }
vs() { envrun crypt crypt "$W/bin/vyre-server" "$@"; }

N=0; PASS=0; FAIL=0
# check NAME FUNCTION: runs the function in a subshell with errexit; its output goes to $W/out.
check() {
  N=$((N + 1))
  name=$1; fn=$2
  # Not inside an `if`: errexit is ignored in a condition, even in a subshell, and every line of a check must be able to fail it.
  set +e
  ( set -eu; "$fn" ) >"$W/out" 2>&1
  rc=$?
  set -e
  if [ "$rc" = 0 ]; then PASS=$((PASS + 1)); echo "ok $N - $name"
  else FAIL=$((FAIL + 1)); echo "not ok $N - $name"; sed 's/^/#   /' "$W/out" | tail -n 40; fi
}
# absent PATTERN FILE: fails when the pattern is there (`! grep` would not stop errexit).
absent() { if grep -q "$1" "$2"; then echo "unexpected text in $2: $1"; return 1; fi; }
expect_status() { want=$1; shift; set +e; "$@" >"$W/cmd.out" 2>&1; got=$?; set -e; cat "$W/cmd.out"; [ "$got" = "$want" ] || { echo "wanted exit $want, got $got"; return 1; }; }

# ---- the checks -----------------------------------------------------------------------------------------------------------------------
mkrel 1.0.0 good; publish 1.0.0

t_refuse_plain_disk() {
  expect_status 3 envrun plain plain sh "$HERE/install.sh" --yes
  grep -q "not on an encrypted volume" "$W/cmd.out"
  grep -q "luksFormat" "$W/cmd.out"
  [ ! -e "$W/srv" ]
}
t_dry_run() {
  install_enc --yes --dry-run >"$W/dry.out"
  cat "$W/dry.out"
  grep -q "would" "$W/dry.out"
  [ ! -e "$W/srv" ] && [ ! -e "$W/bin/vyre-server" ] && [ -z "$(ls "$W/units")" ]
}
t_bad_signature() {
  publish 1.0.0 "$W/other.key"
  expect_status 1 install_enc --yes
  grep -q "signature does not match" "$W/cmd.out"
  publish 1.0.0
  [ ! -e "$W/srv" ]
}
t_bad_hash() {
  cp "$W/chan/vyre-server-1.0.0.tgz" "$W/good.tgz"
  printf 'x' >>"$W/chan/vyre-server-1.0.0.tgz"
  expect_status 1 install_enc --yes
  mv "$W/good.tgz" "$W/chan/vyre-server-1.0.0.tgz"
  grep -q "does not match the signed release" "$W/cmd.out"
  [ ! -e "$W/srv" ]
}
t_wrong_version() {
  expect_status 1 install_enc --yes --version 9.9.9
  grep -q "offers 1.0.0, not 9.9.9" "$W/cmd.out"
}
t_install() {
  export VYRE_CODE=setup-code-4f9a
  install_enc --yes --relay >"$W/inst.out" 2>&1 || { cat "$W/inst.out"; return 1; }
  cat "$W/inst.out"
  absent "setup-code-4f9a" "$W/inst.out"
  grep -q "vyre-server doctor is green" "$W/inst.out"
  vs doctor
  vs doctor --json | grep -q '"ok":true'
  [ "$(vs version)" = 1.0.0 ]
  [ "$(cat "$W/srv/current/VERSION")" = 1.0.0 ]
  [ "$(stat -c %a "$W/srv/vyre.env" 2>/dev/null || stat -f %Lp "$W/srv/vyre.env")" = 600 ]
  grep -q '^VYRE_SETUP_CODE=setup-code-4f9a$' "$W/srv/vyre.env"
  grep -q '^VYRE_RELAY_URL=https://relay.vyre.run$' "$W/srv/compose.env"
  [ -x "$W/bin/vyre-server" ]
  docker image inspect "$IMG" >/dev/null
}
t_units() {
  for u in vyre-server.service vyre-server-update.service vyre-server-update.timer; do
    [ -f "$W/units/$u" ]
    absent '@[A-Z_]*@' "$W/units/$u"
    grep -q "Vyre Server, installed by install.sh" "$W/units/$u"
  done
  grep -q "ExecStart=$W/bin/vyre-server update --yes" "$W/units/vyre-server-update.service"
  grep -q "OnCalendar=" "$W/units/vyre-server-update.timer"
  grep -q "RequiresMountsFor=$W/srv" "$W/units/vyre-server.service"
  grep -q "systemctl daemon-reload" "$W/systemctl.log"
  grep -q "systemctl enable vyre-server.service" "$W/systemctl.log"
  grep -q "systemctl enable --now vyre-server-update.timer" "$W/systemctl.log"
}
t_stack_shape() {
  vs status | grep -q vyred
  vs status | grep -q caddy
  [ "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" | wc -l | tr -d ' ')" -ge 2 ]
  curl -fsS "http://127.0.0.1:$PORT/healthz" | grep -q ok
}
t_rerun_keeps_config() {
  printf 'MY_SETTING=keep\n' >>"$W/srv/vyre.env"
  install_enc --yes >"$W/inst2.out" 2>&1 || { cat "$W/inst2.out"; return 1; }
  cat "$W/inst2.out"
  grep -q '^MY_SETTING=keep$' "$W/srv/vyre.env"
  grep -q '^VYRE_RELAY_URL=https://relay.vyre.run$' "$W/srv/compose.env"
  vs doctor --quiet
}
t_doctor_red_on_plain_disk() {
  expect_status 1 envrun plain plain "$W/bin/vyre-server" doctor
  grep -q "DOWN host.disk_encrypted" "$W/cmd.out"
}
t_update() {
  mkrel 1.1.0 good; publish 1.1.0
  expect_status 10 vs update --check
  grep -q "1.1.0 is available" "$W/cmd.out"
  vs update --yes
  [ "$(vs version)" = 1.1.0 ]
  vs doctor --quiet
  ls "$W"/srv/backups/vyre-pre-1.1.0-*.tar.gz >/dev/null
  tail -n 1 "$W/srv/state/updates.tsv" | grep -q "ok"
  vs update --check | grep -q "newest"
}
t_manual_rollback() {
  vs rollback
  [ "$(vs version)" = 1.0.0 ]
  vs doctor --quiet
}
t_failed_update_rolls_back() {
  mkrel 1.2.0 bad; publish 1.2.0
  expect_status 4 envrun crypt crypt env VYRE_UP_WAIT=30 "$W/bin/vyre-server" update --yes
  grep -q "back on 1.0.0" "$W/cmd.out"
  [ "$(vs version)" = 1.0.0 ]
  vs doctor --quiet
  tail -n 1 "$W/srv/state/updates.tsv" | grep -q "rolled_back"
}
t_uninstall_keeps_data() {
  install_enc --uninstall --yes >/dev/null
  [ ! -e "$W/bin/vyre-server" ]
  [ ! -e "$W/units/vyre-server.service" ]
  [ -d "$W/srv/data/space" ]
  [ -d "$W/srv/backups" ]
}
t_purge() {
  install_enc --uninstall --purge --yes >/dev/null
  [ ! -e "$W/srv" ]
}

check "refuses to install when the data directory is not on an encrypted volume" t_refuse_plain_disk
check "--dry-run prints the plan and changes nothing" t_dry_run
check "a manifest signed with another key stops the install" t_bad_signature
check "a download that does not match the signed hash stops the install" t_bad_hash
check "--version that the channel does not offer stops the install" t_wrong_version
check "install on an encrypted volume ends with doctor green and the setup code kept out of the output" t_install
check "systemd units are written from the release, marked, and enabled" t_units
check "server and caddy are up and /healthz answers" t_stack_shape
check "a re-run keeps vyre.env and the chosen relay" t_rerun_keeps_config
check "doctor goes red when the data directory is on a plain disk" t_doctor_red_on_plain_disk
check "update checks the signed manifest, backs up, switches and stays healthy" t_update
check "rollback goes back to the earlier release" t_manual_rollback
check "an update whose server never gets healthy is rolled back" t_failed_update_rolls_back
check "uninstall removes the units and the command and keeps the data and backups" t_uninstall_keeps_data
check "uninstall --purge removes the data too" t_purge

echo "# pass $PASS fail $FAIL"
[ "$FAIL" = 0 ]
