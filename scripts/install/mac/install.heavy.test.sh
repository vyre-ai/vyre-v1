#!/bin/sh
# @heavy: S14, the Mac installer on a real Mac with real Colima and real launchd (P-L10_10, spec 3.13, ARCH 7.13 R18).
#
# The question (R18): on a Mac, does `install.sh` bring up Colima, a site container and an agent computer, can Caddy reach both, do bind mounts and port forwarding work, and does
# everything come back after a restart. This drives the real install.sh and the real vyre-server against a signed stand-in release (busybox: an HTTP /healthz, and a "caddy" that
# shares its network namespace, the same compose shape as images/vyred/compose.server.yml), with the pinned Colima, Lima, docker and Compose downloaded for real:
#   install ends with `doctor` green and Colima loaded as a LaunchDaemon; the data folder is bind-mounted into the VM (a file the container writes shows up on the Mac);
#   the Space answers on 127.0.0.1:8420 through Colima's port forwarding; a site container and an agent computer container start, and the caddy container reaches both by name;
#   a restart is simulated by killing Colima and re-running the boot jobs with launchctl kickstart (the same jobs RunAtLoad runs at boot): Colima, the containers and /healthz come
#   back by themselves; idle CPU and disk use are recorded; uninstall --purge leaves no container, no VM, no job and no folder.
# A real reboot cannot run in CI. It is the one step done by hand on the Mac mini (reboot, wait, `vyre-server doctor`); the kickstart step proves the jobs, the reboot proves the boot order.
#
# The Mac is touched on purpose: real LaunchDaemons (run.vyre.*) in /Library/LaunchDaemons, a real Colima VM, /usr/local/bin/vyre-server. It refuses to run where those exist already, unless
# VYRE_HEAVY_MAC_FORCE=1. Only the release key (a test key) and the FileVault answer (a hosted runner has FileVault off) are faked; the FileVault rule itself is proved in install.test.ts.
# The sudo password must not be needed: run it on a runner with passwordless sudo, or `sudo -v` first.
#
# Runs only with VYRE_HEAVY_MAC=1 on macOS 13 or newer with OpenSSL 3 (VYRE_OPENSSL names it, e.g. Homebrew's) and Node (for the signature check); otherwise it says it skipped, and a skip is not a pass.
# Output: one "ok N - name" or "not ok N - name" line per check, a "# perf ..." line, then "# pass P fail F"; exit 1 when anything failed.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
if [ "${VYRE_HEAVY_MAC:-0}" != 1 ] || [ "$(uname -s)" != Darwin ]; then
  echo "skipped: S14 needs a real Mac and VYRE_HEAVY_MAC=1"
  exit 0
fi
OPENSSL=${VYRE_OPENSSL:-$(command -v openssl || true)}
"$OPENSSL" version 2>/dev/null | grep -q '^OpenSSL 3' || { echo "not ok 0 - OpenSSL 3 is needed to sign the test release (set VYRE_OPENSSL; Homebrew: openssl@3)" >&2; exit 1; }
NODE=${VYRE_VERIFY_NODE:-$(command -v node || true)}
[ -n "$NODE" ] || { echo "not ok 0 - node is needed to check the release signature (set VYRE_VERIFY_NODE)" >&2; exit 1; }
for f in /Library/LaunchDaemons/run.vyre.server.plist /Library/LaunchDaemons/run.vyre.colima.plist /usr/local/bin/vyre-server; do
  if [ -e "$f" ] && [ "${VYRE_HEAVY_MAC_FORCE:-0}" != 1 ]; then echo "not ok 0 - $f exists: this Mac already runs Vyre Server. Use another Mac, or VYRE_HEAVY_MAC_FORCE=1 to replace it." >&2; exit 1; fi
done
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:8420 -sTCP:LISTEN >/dev/null 2>&1; then echo "not ok 0 - port 8420 is in use on this Mac" >&2; exit 1; fi

W=$(mktemp -d "${TMPDIR:-/tmp}/vyre-mac-heavy.XXXXXX")
D=$W/srv
BASE_IMAGE=${VYRE_HEAVY_BASE_IMAGE:-busybox:1.36.1}
PORT=8420

cleanup() {
  [ ! -x "$D/current/bin/vyre-server" ] || envrun sh "$HERE/install.sh" --yes --uninstall --purge >/dev/null 2>&1 || true
  for c in vyre-s14-site vyre-s14-agent; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker network rm vyre-s14 >/dev/null 2>&1 || true
  rm -rf "$W"
}
trap cleanup EXIT

mkdir -p "$W/shim" "$W/bin" "$W/chan" "$W/stage"
printf '#!/bin/sh\necho "FileVault is On."\n' >"$W/shim/fdesetup"
chmod +x "$W/shim/fdesetup"

# ---- a signed stand-in release (the real vyre-server and the real plists) --------------------------------------------------------------------
"$OPENSSL" genpkey -algorithm ed25519 -out "$W/release.key" 2>/dev/null
"$OPENSSL" pkey -in "$W/release.key" -pubout -out "$W/release.pub" 2>/dev/null

# The stand-in release names its image by digest (the installer refuses a tag). Colima is not up yet, so the digest is pinned here: the multi-arch index of busybox 1.36.1
# on Docker Hub (the Docker-Content-Digest header of /v2/library/busybox/manifests/1.36.1, read 2026-10-25). VYRE_HEAVY_IMAGE overrides it.
IMG=${VYRE_HEAVY_IMAGE:-busybox:1.36.1@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662}
case "$IMG" in *@sha256:*) ;; *) echo "not ok 0 - the stand-in image has no digest" >&2; exit 1 ;; esac

v=1.0.0
d=$W/stage/vyre-server-mac-$v
mkdir -p "$d/bin" "$d/units"
printf '%s' "$v" >"$d/VERSION"
printf '# stand-in Caddyfile\n' >"$d/Caddyfile"
printf 'VYRE_IMAGE=%s\nVYRE_AGENT_IMAGE=%s\nVYRE_SANDBOX_IMAGE=%s\n' "$IMG" "$IMG" "$IMG" >"$d/images.lock"
cp "$HERE/vyre-server" "$d/bin/vyre-server"
cp "$HERE/units/"* "$d/units/"
cat >"$d/compose.server.yml" <<'YML'
services:
  vyred:
    image: ${VYRE_IMAGE}
    command: ["sh","-c","mkdir -p /www && echo ok > /www/healthz && echo 1.0.0 > /data/running-version && exec httpd -f -p 8420 -h /www"]
    healthcheck: { test: ["CMD","wget","-q","-O","-","http://127.0.0.1:8420/healthz"], interval: 2s, timeout: 2s, retries: 2, start_period: 1s }
    restart: unless-stopped
    ports: ["127.0.0.1:${VYRE_PORT:-8420}:8420"]
    volumes: [ "vyre-data:/data", "vyre-work:/work" ]
  caddy:
    image: ${VYRE_IMAGE}
    network_mode: "service:vyred"
    command: ["sleep", "86400"]
    restart: unless-stopped
    depends_on: { vyred: { condition: service_started } }
    volumes: [ "caddy-data:/cd", "caddy-config:/cc" ]
volumes:
  vyre-data:
  vyre-work:
  caddy-data:
  caddy-config:
YML
tar -czf "$W/chan/vyre-server-mac-$v.tgz" -C "$W/stage" "vyre-server-mac-$v"
sum=$(shasum -a 256 "$W/chan/vyre-server-mac-$v.tgz" | awk '{print $1}')
printf '{"v":1,"channel":"stable","server_mac":{"version":"%s","tarball":"vyre-server-mac-%s.tgz","sha256":"%s"}}\n' "$v" "$v" "$sum" >"$W/chan/stable.json"
{ printf 'vyre-release-sums\n'; cat "$W/chan/stable.json"; } >"$W/signed.msg"
"$OPENSSL" pkeyutl -sign -inkey "$W/release.key" -rawin -in "$W/signed.msg" -out "$W/sig.bin"
"$OPENSSL" base64 -A -in "$W/sig.bin" >"$W/chan/stable.json.sig"

envrun() {
  env VYRE_TEST_MODE=1 VYRE_TEST_ROOT_OK=1 VYRE_DIR="$D" VYRE_UPDATE_URL="file://$W/chan/" VYRE_RELEASE_KEY_PEM="$W/release.pub" VYRE_VERIFY_NODE="$NODE" \
    VYRE_TEST_FDESETUP="$W/shim/fdesetup" VYRE_MIN_FREE_MB=2048 VYRE_UP_WAIT=240 VYRE_RUNTIME_WAIT=900 "$@"
}
DOCKER_SOCK=$HOME/.colima/default/docker.sock
dk() { DOCKER_HOST=unix://$DOCKER_SOCK "$D/tools/bin/docker" "$@"; }

N=0; PASS=0; FAIL=0
check() {
  N=$((N + 1)); name=$1; fn=$2
  set +e; ( set -eu; "$fn" ) >"$W/out" 2>&1; rc=$?; set -e
  if [ "$rc" = 0 ]; then PASS=$((PASS + 1)); echo "ok $N - $name"
  else FAIL=$((FAIL + 1)); echo "not ok $N - $name"; sed 's/^/#   /' "$W/out" | tail -n 60; fi
}
wait_for() { # wait_for SECONDS CMD...
  t=$1; shift; n=0
  until "$@" >/dev/null 2>&1; do n=$((n + 3)); [ "$n" -lt "$t" ] || return 1; sleep 3; done
}
healthz() { curl -fsS --max-time 5 "http://127.0.0.1:$PORT/healthz" | grep -q ok; }

t_install() {
  envrun sh "$HERE/install.sh" --yes --relay >"$W/inst.out" 2>&1 || { cat "$W/inst.out"; echo "--- ha.stderr.log"; tail -n 30 "$HOME/.colima/_lima/colima/ha.stderr.log" 2>/dev/null || true; echo "--- serial"; tail -n 20 "$HOME"/.colima/_lima/colima/serial*.log 2>/dev/null || true; return 1; }
  grep -q "Container runtime: Colima" "$W/inst.out"
  grep -q "vyre-server doctor is green" "$W/inst.out"
  [ -f /Library/LaunchDaemons/run.vyre.colima.plist ] && [ -f /Library/LaunchDaemons/run.vyre.server.plist ] && [ -f /Library/LaunchDaemons/run.vyre.server-update.plist ]
  sudo launchctl print system/run.vyre.colima >/dev/null
}
t_colima_vm() {
  "$D/tools/bin/colima" status 2>&1 | grep -qi running
  dk info --format '{{.OSType}}' | grep -q linux
  mem=$(dk info --format '{{.MemTotal}}')
  [ "$mem" -ge 3500000000 ]
}
t_port_forwarding() { healthz; }
t_bind_mount() {
  # vyred wrote /data/running-version inside the container; /data is the bind mount of $D/data/space on the Mac.
  wait_for 60 test -f "$D/data/space/running-version"
  [ "$(cat "$D/data/space/running-version")" = 1.0.0 ]
}
t_site_and_agent_computer() {
  dk pull -q "$IMG" >/dev/null
  dk network create vyre-s14 >/dev/null
  dk run -d --restart unless-stopped --name vyre-s14-site --network vyre-s14 --network-alias site "$IMG" sh -c 'mkdir -p /w && echo site-ok > /w/index.html && exec httpd -f -p 8080 -h /w' >/dev/null
  dk run -d --restart unless-stopped --name vyre-s14-agent --network vyre-s14 --network-alias agentpc "$IMG" sh -c 'mkdir -p /w && echo agent-ok > /w/index.html && exec httpd -f -p 8080 -h /w' >/dev/null
  wait_for 60 dk exec vyre-s14-site wget -q -O - http://127.0.0.1:8080/
}
t_caddy_reaches_both() {
  vy=$(dk ps -q --filter "label=com.docker.compose.service=vyred" | head -n 1)
  cd=$(dk ps -q --filter "label=com.docker.compose.service=caddy" | head -n 1)
  [ -n "$vy" ] && [ -n "$cd" ]
  dk network connect vyre-s14 "$vy"
  [ "$(dk exec "$cd" wget -q -O - http://site:8080/)" = site-ok ]
  [ "$(dk exec "$cd" wget -q -O - http://agentpc:8080/)" = agent-ok ]
}
t_restart_comes_back() {
  # What a reboot does to the jobs: Colima is killed, launchd restarts it (KeepAlive), the boot job runs `vyre-server start` again, and the containers return.
  sudo launchctl kickstart -k system/run.vyre.colima
  wait_for 600 dk info
  sudo launchctl kickstart -k system/run.vyre.server
  wait_for 300 healthz
  wait_for 120 dk exec vyre-s14-site wget -q -O - http://127.0.0.1:8080/
  wait_for 120 dk exec vyre-s14-agent wget -q -O - http://127.0.0.1:8080/
  envrun "$D/current/bin/vyre-server" doctor --quiet
}
t_perf_idle() {
  # Nothing real to measure means a failure, never an ok: the VM must be running and answering, and the figures must come from it.
  "$D/tools/bin/colima" status 2>&1 | grep -qi running || { echo "Colima is not running: nothing to measure"; return 1; }
  dk info >/dev/null 2>&1 || { echo "Docker does not answer: nothing to measure"; return 1; }
  # Let it settle, then sample the VM's processes for 60 s. CPU is the sum of %cpu of the Colima/Lima/Virtualization processes; disk is what the VM and the install use.
  sleep 60
  sum=0; samples=0
  while [ "$samples" -lt 20 ]; do
    c=$(ps -axo pcpu=,comm= | awk '/[c]olima|[l]imactl|[c]om.apple.Virtualization|[v]z-/ { s += $1 } END { printf "%.1f", s }')
    sum=$(awk -v a="$sum" -v b="$c" 'BEGIN { printf "%.1f", a + b }')
    samples=$((samples + 1)); sleep 3
  done
  idle=$(awk -v a="$sum" -v n="$samples" 'BEGIN { printf "%.1f", a / n }')
  vm_mb=$(du -sm "$HOME/.colima" 2>/dev/null | awk '{print $1}')
  data_mb=$(du -sm "$D/data" 2>/dev/null | awk '{print $1}')
  tools_mb=$(du -sm "$D/tools" 2>/dev/null | awk '{print $1}')
  mem_gib=$(sed -n 's/^COLIMA_MEM=//p' "$D/colima-size.env")
  [ "${vm_mb:-0}" -gt 0 ] && [ "${data_mb:-0}" -gt 0 ] && [ -n "$mem_gib" ] || { echo "no real figures (vm_mb=${vm_mb:-} data_mb=${data_mb:-} mem_gib=${mem_gib:-})"; return 1; }
  echo "# perf s14 idle_cpu_percent=$idle colima_vm_disk_mb=$vm_mb data_mb=$data_mb tools_mb=$tools_mb vm_memory_gib=$mem_gib"
  printf '{"id":"s14","idle_cpu_percent":%s,"colima_vm_disk_mb":%s,"data_mb":%s,"tools_mb":%s,"vm_memory_gib":%s}\n' "$idle" "${vm_mb:-0}" "${data_mb:-0}" "${tools_mb:-0}" "${mem_gib:-0}" >"${VYRE_PERF_OUT:-$W/perf-s14.json}"
}
t_uninstall_purge() {
  envrun sh "$HERE/install.sh" --yes --uninstall >/dev/null
  [ ! -e /Library/LaunchDaemons/run.vyre.server.plist ] && [ ! -e /Library/LaunchDaemons/run.vyre.colima.plist ] && [ ! -e /usr/local/bin/vyre-server ]
  [ -d "$D/data" ]
  for c in vyre-s14-site vyre-s14-agent; do DOCKER_HOST=unix://$DOCKER_SOCK "$D/tools/bin/docker" rm -f "$c" >/dev/null 2>&1 || true; done
  envrun sh "$HERE/install.sh" --yes --uninstall --purge >/dev/null
  [ ! -e "$D" ]
  ! healthz
  [ ! -S "$DOCKER_SOCK" ]
}

check "install: pinned Colima, launchd jobs, signed release, ends with doctor green" t_install
check "Colima VM is running with its memory set" t_colima_vm
check "port forwarding: the Space answers on 127.0.0.1:8420 from the Mac" t_port_forwarding
check "bind mount: a file the container writes is on the Mac under the data folder" t_bind_mount
check "a site container and an agent computer container start" t_site_and_agent_computer
check "Caddy's network reaches the site and the agent computer by name" t_caddy_reaches_both
check "after Colima is killed and the boot jobs run again, Colima, the Space and both containers are back" t_restart_comes_back
check "idle CPU and disk use recorded (perf s14)" t_perf_idle
check "uninstall keeps the data; uninstall --purge leaves no job, command, folder or VM" t_uninstall_purge

echo "# pass $PASS fail $FAIL"
[ "$FAIL" = 0 ]
