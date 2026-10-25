#!/bin/sh
# @heavy: the Linux installer against the REAL vyred image and the REAL compose unit (P-L10_09b, spec 3.13, ARCH 7.13).
# install.heavy.test.sh proves the installer's logic with a stand-in server. This one builds images/vyred, serves it from a throwaway local registry, signs a release that carries the real
# images/vyred/compose.server.yml and Caddyfile, and drives the real install.sh and vyre-server: install, first boot of the real daemon, doctor green (daemon, Caddy and /healthz),
# the sign-in endpoint (identity.sign_in_options) answers through the real gateway, a restart keeps the Space, uninstall keeps the data, and uninstall --purge leaves no container, volume or file.
# The machine is not touched (VYRE_TEST_MODE: temp dirs, a recording systemctl, a fake encrypted-volume answer), exactly as in install.heavy.test.sh.
# Runs only with VYRE_HEAVY_DOCKER=1 on a host with Docker, the compose plugin (or VYRE_COMPOSE_BIN) and OpenSSL 3; otherwise it says it skipped, and a skip is not a pass.
# Output: one "ok N - name" or "not ok N - name" line per check, then "# pass P fail F"; exit 1 when anything failed.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL_DIR=$(cd "$HERE/../linux" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
if [ "${VYRE_HEAVY_DOCKER:-0}" != 1 ]; then
  echo "skipped: VYRE_HEAVY_DOCKER is not 1 (this check needs Docker)"
  exit 0
fi
REAL_DOCKER=$(command -v docker) || { echo "not ok 0 - docker is not installed" >&2; exit 1; }
W=$(mktemp -d "${TMPDIR:-/tmp}/vyre-install-real.XXXXXX")
PROJECT=vyrereal$$
REG=vyrereal-registry-$$
REGPORT=${VYRE_REAL_REGISTRY_PORT:-5055}
PORT=8420

cleanup() {
  if [ -d "$W/srv/current" ]; then COMPOSE_PROJECT_NAME=$PROJECT "$W/shim/docker" compose --project-directory "$W/srv/current" --env-file "$W/srv/compose.env" -f "$W/srv/current/compose.server.yml" -f "$W/srv/compose.override.yml" down -v --remove-orphans >/dev/null 2>&1 || true; fi
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | while read -r c; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | while read -r vol; do docker volume rm -f "$vol" >/dev/null 2>&1 || true; done
  docker rm -f "$REG" >/dev/null 2>&1 || true
  rm -rf "$W" 2>/dev/null || sudo -n rm -rf "$W" 2>/dev/null || docker run --rm -v "$W:/w" busybox:1.36.1 rm -rf /w/srv >/dev/null 2>&1 || true
  rm -rf "$W" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$W/shim" "$W/bin" "$W/units" "$W/chan" "$W/stage"
printf '#!/bin/sh\nif [ "${1:-}" = compose ] && [ -n "${VYRE_COMPOSE_BIN:-}" ]; then shift; exec "$VYRE_COMPOSE_BIN" "$@"; fi\nexec "%s" "$@"\n' "$REAL_DOCKER" >"$W/shim/docker"
printf '#!/bin/sh\necho "systemctl $*" >>"%s/systemctl.log"\n' "$W" >"$W/shim/systemctl"
printf '#!/bin/sh\nprintf "crypt\\ndisk\\n"\n' >"$W/shim/lsblk-crypt"
chmod +x "$W/shim/docker" "$W/shim/systemctl" "$W/shim/lsblk-crypt"
printf '/dev/sda1 / ext4 rw 0 0\n/dev/mapper/vyre-data %s ext4 rw 0 0\n' "$W" >"$W/mounts-crypt"
: >"$W/systemctl.log"
SHIM_PATH="$W/shim:$PATH"
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q "[:.]$PORT "; then echo "not ok 0 - port $PORT is in use on this machine" >&2; exit 1; fi

# ---- the real image, from a local registry so it has a digest -----------------------------------------------------------------------
docker run -d --name "$REG" -p "127.0.0.1:$REGPORT:5000" registry:2 >/dev/null
docker build -q -f "$REPO/images/vyred/Dockerfile" -t "localhost:$REGPORT/vyred:real" "$REPO" >/dev/null
docker push -q "localhost:$REGPORT/vyred:real" >/dev/null
IMG=$(docker image inspect --format '{{index .RepoDigests 0}}' "localhost:$REGPORT/vyred:real")
case "$IMG" in *@sha256:*) ;; *) echo "not ok 0 - the built image has no registry digest ($IMG)" >&2; exit 1 ;; esac
docker rmi "localhost:$REGPORT/vyred:real" "$IMG" >/dev/null 2>&1 || true

# ---- a signed release that carries the real compose unit ----------------------------------------------------------------------------
openssl genpkey -algorithm ed25519 -out "$W/release.key" 2>/dev/null
openssl pkey -in "$W/release.key" -pubout -out "$W/release.pub" 2>/dev/null
v=1.0.0
d=$W/stage/vyre-server-$v
mkdir -p "$d/bin" "$d/units"
printf '%s' "$v" >"$d/VERSION"
cp "$REPO/images/vyred/compose.server.yml" "$REPO/images/vyred/Caddyfile" "$d/"
printf 'VYRE_IMAGE=%s\nVYRE_AGENT_IMAGE=%s\nVYRE_SANDBOX_IMAGE=%s\n' "$IMG" "$IMG" "$IMG" >"$d/images.lock"
cp "$INSTALL_DIR/vyre-server" "$d/bin/vyre-server"
cp "$INSTALL_DIR/units/"* "$d/units/"
tar -czf "$W/chan/vyre-server-$v.tgz" -C "$W/stage" "vyre-server-$v"
sum=$(sha256sum "$W/chan/vyre-server-$v.tgz" | awk '{print $1}')
printf '{"v":1,"channel":"stable","server":{"version":"%s","tarball":"vyre-server-%s.tgz","sha256":"%s"}}\n' "$v" "$v" "$sum" >"$W/chan/stable.json"
{ printf 'vyre-release-sums\n'; cat "$W/chan/stable.json"; } >"$W/signed.msg"
openssl pkeyutl -sign -inkey "$W/release.key" -rawin -in "$W/signed.msg" -out "$W/sig.bin"
openssl base64 -A -in "$W/sig.bin" >"$W/chan/stable.json.sig"

envrun() {
  env PATH="$SHIM_PATH" VYRE_TEST_MODE=1 VYRE_TEST_NONROOT=1 VYRE_DIR="$W/srv" VYRE_BIN_DIR="$W/bin" VYRE_SYSTEMD_DIR="$W/units" \
    VYRE_UPDATE_URL="file://$W/chan/" VYRE_RELEASE_KEY_PEM="$W/release.pub" VYRE_TEST_PROC_MOUNTS="$W/mounts-crypt" VYRE_TEST_LSBLK="$W/shim/lsblk-crypt" \
    VYRE_MIN_FREE_MB=100 VYRE_UP_WAIT=240 VYRE_TEST_HEALTH_URL="http://127.0.0.1:$PORT/healthz" COMPOSE_PROJECT_NAME=$PROJECT "$@"
}
install_enc() { envrun sh "$INSTALL_DIR/install.sh" "$@"; }
vs() { envrun "$W/bin/vyre-server" "$@"; }

N=0; PASS=0; FAIL=0
check() {
  N=$((N + 1)); name=$1; fn=$2
  set +e; ( set -eu; "$fn" ) >"$W/out" 2>&1; rc=$?; set -e
  if [ "$rc" = 0 ]; then PASS=$((PASS + 1)); echo "ok $N - $name"
  else FAIL=$((FAIL + 1)); echo "not ok $N - $name"; sed 's/^/#   /' "$W/out" | tail -n 60; fi
}

t_installer_names_a_space() {
  # The compose unit hands the daemon VYRE_SPACE from compose.env; the daemon refuses to boot a data directory that has no Space ("pass --space <id> to create one").
  # So the installer itself must write a Space id (or the daemon must create one). Run the plain install and read the daemon's own words if it does not come up.
  env -u VYRE_SPACE PATH="$SHIM_PATH" VYRE_TEST_MODE=1 VYRE_TEST_NONROOT=1 VYRE_DIR="$W/srv" VYRE_BIN_DIR="$W/bin" VYRE_SYSTEMD_DIR="$W/units" \
    VYRE_UPDATE_URL="file://$W/chan/" VYRE_RELEASE_KEY_PEM="$W/release.pub" VYRE_TEST_PROC_MOUNTS="$W/mounts-crypt" VYRE_TEST_LSBLK="$W/shim/lsblk-crypt" \
    VYRE_MIN_FREE_MB=100 VYRE_UP_WAIT=90 VYRE_TEST_HEALTH_URL="http://127.0.0.1:$PORT/healthz" COMPOSE_PROJECT_NAME=$PROJECT sh "$INSTALL_DIR/install.sh" --yes >"$W/inst0.out" 2>&1 || {
      for c in $(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"); do echo "--- logs of $c"; docker logs "$c" 2>&1 | tail -n 5; done
      return 1
    }
}
reset_stack() {
  if [ -d "$W/srv/current" ]; then COMPOSE_PROJECT_NAME=$PROJECT "$W/shim/docker" compose --project-directory "$W/srv/current" --env-file "$W/srv/compose.env" -f "$W/srv/current/compose.server.yml" -f "$W/srv/compose.override.yml" down -v --remove-orphans >/dev/null 2>&1 || true; fi
  sudo -n chown -R "$(id -u):$(id -g)" "$W/srv" 2>/dev/null || true
  rm -rf "$W/srv" "$W/bin/vyre-server" "$W/units"/* 2>/dev/null || true
}
t_install_first_boot() {
  install_enc --yes >"$W/inst.out" 2>&1 || { cat "$W/inst.out"; docker ps -a; for c in $(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"); do echo "--- logs of $c"; docker logs "$c" 2>&1 | tail -n 40; done; return 1; }
  grep -q "vyre-server doctor is green" "$W/inst.out"
  [ "$(vs version)" = 1.0.0 ]
}
t_doctor_green() {
  vs doctor
  vs doctor --json | grep -q '"ok":true'
}
t_real_daemon_answers() {
  body=$(curl -fsS "http://127.0.0.1:$PORT/healthz")
  echo "$body"
  echo "$body" | grep -q '"ok":true'
  [ "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" | wc -l | tr -d ' ')" -ge 2 ]
}
t_sign_in_reachable() {
  # The sign-in page's data comes from identity.sign_in_options, a pre-auth read. The real gateway must route it (never 404 unknown capability).
  code=$(curl -s -o "$W/signin.json" -w '%{http_code}' "http://127.0.0.1:$PORT/v1/identity/sign_in_options")
  cat "$W/signin.json"; echo
  if node_live=$(grep -c "{ *\"id\": *\"identity\"[^}]*\"status\": *\"live\"" "$REPO/host/modules.json" 2>/dev/null) && [ "$node_live" -ge 1 ]; then
    [ "$code" = 200 ]
    grep -q '"fingerprint"' "$W/signin.json"
  else
    # identity is still a stub in host/modules.json: the route exists and the real gateway answers with its structured not-implemented error
    [ "$code" != 404 ]
    ! grep -q 'unknown_capability' "$W/signin.json"
    grep -q '"error"' "$W/signin.json"
  fi
}
t_restart_keeps_space() {
  before=$(docker exec "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "name=vyred" | head -n 1)" sh -c 'ls /data' | sort | tr '\n' ' ')
  vs restart >/dev/null 2>&1
  vs doctor --quiet
  after=$(docker exec "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "name=vyred" | head -n 1)" sh -c 'ls /data' | sort | tr '\n' ' ')
  [ "$before" = "$after" ]
}
t_uninstall_keeps_data() {
  install_enc --uninstall --yes >/dev/null
  [ ! -e "$W/bin/vyre-server" ] && [ ! -e "$W/units/vyre-server.service" ]
  [ -d "$W/srv/data" ] || [ -d "$W/srv" ]
}
t_purge_leaves_nothing() {
  # The container writes the data as its own user. A real install runs as root and removes it; this test runs as an ordinary user, so hand the files back first.
  [ "$(id -u)" = 0 ] || sudo -n chown -R "$(id -u):$(id -g)" "$W/srv" 2>/dev/null || true
  install_enc --uninstall --purge --yes >/dev/null
  [ ! -e "$W/srv" ]
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ]
  [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")" ]
  [ -z "$(ls "$W/units")" ]
  ! curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1
}

check "the installer gives the daemon a Space id, so a plain install boots" t_installer_names_a_space
reset_stack
# Until the installer supplies one, the rest of the real path is proved with a Space id handed in the way an operator would.
export VYRE_SPACE=${VYRE_REAL_SPACE:-spc_realtest}
check "install pulls the real image and the real daemon boots for the first time, ending with doctor green" t_install_first_boot
check "doctor is green: daemon, Caddy, /healthz" t_doctor_green
check "the real vyred answers /healthz and server and caddy are up" t_real_daemon_answers
check "the sign-in endpoint is routed by the real gateway" t_sign_in_reachable
check "a restart keeps the Space data" t_restart_keeps_space
check "uninstall removes the units and the command and keeps the data" t_uninstall_keeps_data
check "uninstall --purge leaves no container, no volume, no file and nothing listening" t_purge_leaves_nothing

echo "# pass $PASS fail $FAIL"
[ "$FAIL" = 0 ]
