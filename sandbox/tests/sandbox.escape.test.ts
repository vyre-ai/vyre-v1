// Escape (S8, spec 4.17): a sandbox cannot read outside its mounts and cannot reach a host that is not on the allow-list. Proved at every layer that matters: the spec is refused before anything is
// built, the container config never gives more than the profile (reviewed on every create), the Seatbelt profile and bwrap arguments only ever name the person's folders, the proxy refuses what is
// not listed (real sockets), and the self-test finds a sandbox that leaks.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_READ, SandboxError, seatbeltCommand, confinementProbe, containerConfig, createEgressProxy, networkName, reviewContainerConfig, sbplString, seatbeltProfile, validateSpec, within,
} from "../src/index.ts";
import { bwrapCommand } from "../src/bwrap.ts";
import { startDockerSandbox } from "../src/docker.ts";
import type { ContainerConfig, ProxyHandle, Sandbox } from "../src/index.ts";
import { ROOTS, echoServer, fakeDocker, rawExchange, rng, spec } from "./helpers.ts";

const isPolicy = (e: unknown): boolean => e instanceof SandboxError && e.code === "sandbox.policy";
const mountSpec = (host: string, mode: "ro" | "rw" = "rw") => spec({ mounts: [{ host, mode }] });

// ---- the spec

const HOSTILE: Array<[string, string]> = [
  ["the whole disk", "/"],
  ["system folder", "/etc"],
  ["a file in a system folder", "/etc/passwd"],
  ["the Docker socket", "/var/run/docker.sock"],
  ["the run folder", "/run/docker.sock"],
  ["Docker's own data", "/var/lib/docker"],
  ["another person's folder", "/srv/vyre/people/ravi/site"],
  ["a folder that only starts like the person's", "/srv/vyre/people/dana-evil/site"],
  ["the parent of the person's folders", "/srv/vyre/people"],
  ["climbing out", "/srv/vyre/people/dana/../ravi/site"],
  ["climbing out deeper", "/srv/vyre/people/dana/site/../../ravi"],
  ["a relative path", "srv/vyre/people/dana/site"],
  ["a NUL", "/srv/vyre/people/dana/site\u0000/etc"],
  ["a line break", "/srv/vyre/people/dana/site\n/etc"],
  ["closing a profile string and opening a rule", '/srv/vyre/people/dana/site") (allow file-read* (subpath "/'],
  ["a quote and a command", "/srv/vyre/people/dana/site'; rm -rf /"],
  ["bind syntax", "/srv/vyre/people/dana/site:/etc:rw"],
  ["a backslash", "/srv/vyre/people/dana/site\\evil"],
  ["a parenthesis", "/srv/vyre/people/dana/site(1)"],
  ["the person's SSH keys", "/srv/vyre/people/dana/.ssh"],
  ["cloud credentials inside a folder", "/srv/vyre/people/dana/site/.aws/credentials"],
  ["gcloud credentials", "/srv/vyre/people/dana/site/.config/gcloud"],
  ["a socket in a folder", "/srv/vyre/people/dana/site/docker.sock"],
  ["any socket", "/srv/vyre/people/dana/work.sock"],
];

test("a mount is refused unless it is a folder of this person's, however the path is written", () => {
  for (const [why, host] of HOSTILE) {
    assert.throws(() => validateSpec(mountSpec(host), ROOTS), isPolicy, `${why}: ${JSON.stringify(host)}`);
  }
});

test("a link that leads out of the person's folders is refused when links are resolved, and one that stays inside is not", () => {
  const realpath = (p: string): string => ({
    "/srv/vyre/people/dana/to-etc": "/etc",
    "/srv/vyre/people/dana/to-ravi": "/srv/vyre/people/ravi/site",
    "/srv/vyre/people/dana/to-sock": "/var/run/docker.sock",
    "/srv/vyre/people/dana/alias": "/srv/vyre/people/dana/site",
  } as Record<string, string>)[p] ?? p;
  for (const link of ["to-etc", "to-ravi", "to-sock"]) assert.throws(() => validateSpec(mountSpec(`/srv/vyre/people/dana/${link}`), ROOTS, { realpath }), isPolicy, link);
  assert.equal(validateSpec(mountSpec("/srv/vyre/people/dana/alias"), ROOTS, { realpath }).mounts[0]?.host, "/srv/vyre/people/dana/alias");
});

test("a good spec passes and its paths are normalized; the rest of the spec is checked too", () => {
  const ok = validateSpec(spec({ mounts: [{ host: "/srv/vyre/people/dana//site/./sub/", mode: "rw" }], scratch: "/srv/vyre/scratch/dana/s1" }), ROOTS);
  assert.deepEqual(ok.mounts, [{ host: "/srv/vyre/people/dana/site/sub", guest: "/work/sub", mode: "rw" }]);
  assert.equal(ok.scratch, "/srv/vyre/scratch/dana/s1");
  assert.deepEqual(validateSpec(spec({ mounts: [{ host: "/srv/vyre/people/dana/site", guest: "/home/agent/notes", mode: "ro" }] }), ROOTS).mounts[0]?.guest, "/home/agent/notes");

  const bad: Array<[string, Parameters<typeof spec>[0]]> = [
    ["two folders at one place", { mounts: [{ host: "/srv/vyre/people/dana/a/x", mode: "rw" }, { host: "/srv/vyre/people/dana/b/x", mode: "rw" }] }],
    ["a place inside that is the system's", { mounts: [{ host: "/srv/vyre/people/dana/site", guest: "/etc/passwd", mode: "rw" }] }],
    ["a place inside that climbs", { mounts: [{ host: "/srv/vyre/people/dana/site", guest: "/work/../etc", mode: "rw" }] }],
    ["the root of the sandbox", { mounts: [{ host: "/srv/vyre/people/dana/site", guest: "/", mode: "rw" }] }],
    ["no folders", { mounts: [] }],
    ["a mode that is neither", { mounts: [{ host: "/srv/vyre/people/dana/site", mode: "rwx" as "rw" }] }],
    ["root", { user: { uid: 0, gid: 10001 } }],
    ["root's group", { user: { uid: 10001, gid: 0 } }],
    ["a bad id", { id: "Vyre Sandbox" }],
    ["a scratch folder outside the scratch roots", { scratch: "/srv/vyre/people/dana/site" }],
    ["a bad variable name", { env: { "A B": "x" } }],
    ["a wildcard that is everything", { egressHosts: ["*"] }],
    ["a wildcard of wildcards", { egressHosts: ["*.*.com"] }],
    ["an address", { egressHosts: ["10.0.0.1"] }],
    ["a bare name", { egressHosts: ["localhost"] }],
    ["upper case", { egressHosts: ["EXAMPLE.com"] }],
    ["a path", { egressHosts: ["evil.com/path"] }],
    ["a one letter top level", { egressHosts: ["a.b"] }],
  ];
  for (const [why, over] of bad) assert.throws(() => validateSpec(spec(over), ROOTS), isPolicy, why);
});

// ---- the container

const clone = (c: ContainerConfig): ContainerConfig => JSON.parse(JSON.stringify(c)) as ContainerConfig;
const good = (): ContainerConfig => containerConfig(spec(), validateSpec(spec(), ROOTS).mounts, "http://172.30.1.1:3128");

test("the container the sandbox asks for is within the profile: non-root, read-only, no capabilities, only the person's folders, its own internal network", () => {
  const c = good();
  assert.deepEqual(reviewContainerConfig(c, "vyre-sbx-dana", ROOTS.work), []);
  const h = c.HostConfig;
  assert.equal(c.User, "10001:10001");
  assert.equal(h.ReadonlyRootfs, true);
  assert.deepEqual(h.CapDrop, ["ALL"]);
  assert.deepEqual(h.CapAdd, []);
  assert.equal(h.Privileged, false);
  assert.equal(h.NetworkMode, networkName("vyre-sbx-dana"));
  assert.deepEqual(h.Binds, ["/srv/vyre/people/dana/site:/work/site:rw", "/srv/vyre/people/dana/reference:/work/reference:ro"]);
  assert.deepEqual(Object.keys(h.Tmpfs).sort(), ["/home/agent", "/run/vyre-creds", "/tmp"]);
  assert.ok(c.Env.includes("HTTPS_PROXY=http://172.30.1.1:3128"));
  assert.ok(h.Memory > 0 && h.MemorySwap === h.Memory && h.PidsLimit > 0 && h.NanoCpus > 0);
  assert.ok(!JSON.stringify(c).includes("docker.sock"));
});

test("the review names every way a container could give more than the profile", () => {
  const mutations: Array<[string, (c: ContainerConfig) => void, RegExp]> = [
    ["privileged", (c) => { c.HostConfig.Privileged = true; }, /privileged/],
    ["an added capability", (c) => { c.HostConfig.CapAdd = ["SYS_ADMIN"]; }, /adds capabilities/],
    ["capabilities kept", (c) => { c.HostConfig.CapDrop = []; }, /drop all/],
    ["a writable root", (c) => { c.HostConfig.ReadonlyRootfs = false; }, /writable/],
    ["new privileges", (c) => { c.HostConfig.SecurityOpt = []; }, /new privileges/],
    ["seccomp off", (c) => { c.HostConfig.SecurityOpt = ["no-new-privileges:true", "seccomp=unconfined"]; }, /weakens/],
    ["the host network", (c) => { c.HostConfig.NetworkMode = "host"; }, /network is host/],
    ["the default bridge", (c) => { c.HostConfig.NetworkMode = "bridge"; }, /network is bridge/],
    ["the host's processes", (c) => { c.HostConfig.PidMode = "host"; }, /PID/],
    ["the host's IPC", (c) => { c.HostConfig.IpcMode = "host"; }, /IPC/],
    ["the host's users", (c) => { c.HostConfig.UsernsMode = "host"; }, /user namespace/],
    ["a device", (c) => { c.HostConfig.Devices = [{ PathOnHost: "/dev/kmem" }]; }, /devices/],
    ["the Docker socket", (c) => { c.HostConfig.Binds.push("/var/run/docker.sock:/var/run/docker.sock:rw"); }, /socket or runtime/],
    ["the system", (c) => { c.HostConfig.Binds.push("/etc:/work/etc:ro"); }, /outside the person's folders/],
    ["a folder into the system", (c) => { c.HostConfig.Binds.push("/srv/vyre/people/dana/site:/etc:rw"); }, /binds into/],
    ["a bind with no mode", (c) => { c.HostConfig.Binds.push("/srv/vyre/people/dana/site:/work/x"); }, /host:guest:mode/],
    ["root", (c) => { c.User = "root"; }, /runs as/],
    ["uid 0", (c) => { c.User = "0:0"; }, /runs as/],
    ["gid 0", (c) => { c.User = "10001:0"; }, /runs as/],
    ["no memory limit", (c) => { c.HostConfig.Memory = 0; }, /limit/],
    ["swap beyond memory", (c) => { c.HostConfig.MemorySwap = c.HostConfig.Memory * 2; }, /swap/],
    ["another tmpfs", (c) => { c.HostConfig.Tmpfs["/etc"] = "rw"; }, /unexpected tmpfs/],
    ["another name", (c) => { c.Hostname = "other"; }, /hostname/],
    ["a name that points inside", (c) => { c.HostConfig.ExtraHosts = ["metadata:169.254.169.254"]; }, /name resolution/],
  ];
  for (const [why, mutate, expect] of mutations) {
    const c = clone(good());
    mutate(c);
    const problems = reviewContainerConfig(c, "vyre-sbx-dana", ROOTS.work);
    assert.ok(problems.some((p) => expect.test(p)), `${why}: ${JSON.stringify(problems)}`);
  }
});

test("Docker: nothing is created for a spec that fails the policy, a container that fails the review is never created, and a failed start undoes what was set up", async () => {
  const closed: string[] = [];
  const startProxy = async (a: { allow: readonly string[]; host: string }): Promise<ProxyHandle> => ({ port: 3128, close: async () => { closed.push(a.host); } });

  const d1 = fakeDocker();
  await assert.rejects(() => startDockerSandbox(mountSpec("/etc"), { api: d1.api, roots: ROOTS, startProxy }), isPolicy);
  assert.deepEqual(d1.calls, [], "refused before Docker was asked anything");

  const d2 = fakeDocker();
  d2.hasImage = false;
  await assert.rejects(() => startDockerSandbox(spec(), { api: d2.api, roots: ROOTS, startProxy }), (e: unknown) => e instanceof SandboxError && e.code === "sandbox.image_missing");
  assert.deepEqual(d2.calls, ["imageExists"]);

  for (const step of ["containerCreate", "containerStart"]) {
    const d = fakeDocker();
    d.failOn.add(step);
    closed.length = 0;
    await assert.rejects(() => startDockerSandbox(spec(), { api: d.api, roots: ROOTS, startProxy }), new RegExp(step));
    assert.equal(d.networks.size, 0, `${step}: the network is removed`);
    assert.equal(d.containers.size, 0, `${step}: no container is left`);
    assert.equal(closed.length, 1, `${step}: the proxy is closed`);
  }
});

test("Docker: the running sandbox is the reviewed one, its proxy is on the network's gateway with only the person's hosts, and stop removes all of it, twice over", async () => {
  const d = fakeDocker();
  const proxies: Array<{ allow: readonly string[]; host: string; closed: boolean }> = [];
  const startProxy = async (a: { allow: readonly string[]; host: string }): Promise<ProxyHandle> => { const p = { ...a, closed: false }; proxies.push(p); return { port: 4040, close: async () => { p.closed = true; } }; };
  const sbx = await startDockerSandbox(spec(), { api: d.api, roots: ROOTS, startProxy });
  assert.deepEqual(d.calls.slice(0, 4), ["imageExists", "networkCreate", "containerCreate", "containerStart"]);
  assert.deepEqual([...d.networks.keys()], ["vyre-sbx-dana-net"]);
  assert.deepEqual(proxies.map((p) => [p.allow, p.host]), [[["api.anthropic.com", "*.openai.com"], "172.30.1.1"]]);
  const [ctr] = [...d.containers.values()];
  assert.equal(ctr?.name, "vyre-sbx-dana");
  assert.deepEqual(reviewContainerConfig(ctr!.config, "vyre-sbx-dana", ROOTS.work), []);
  assert.ok(ctr!.config.Env.includes("HTTPS_PROXY=http://172.30.1.1:4040"));
  assert.equal(sbx.env()["HTTPS_PROXY"], "http://172.30.1.1:4040");
  await sbx.stop();
  await sbx.stop();
  assert.equal(d.containers.size, 0);
  assert.equal(d.networks.size, 0);
  assert.equal(proxies[0]?.closed, true);
  assert.equal(d.calls.filter((c) => c === "containerRemove").length, 1);
  await assert.rejects(() => sbx.exec({ argv: ["ls"] }), (e: unknown) => e instanceof SandboxError && e.code === "sandbox.stopped");
});

// ---- the Mac and Linux profiles

const hostile = spec({ mounts: [{ host: "/srv/vyre/people/dana/site", mode: "rw" }, { host: "/srv/vyre/people/dana/reference", mode: "ro" }], scratch: "/srv/vyre/scratch/dana/s1" });

test("the Seatbelt profile denies by default, writes only in the rw folders and scratch, and reaches the network only at the proxy's port on loopback", () => {
  const checked = validateSpec(hostile, ROOTS);
  const p = seatbeltProfile(checked, { proxyPort: 4040 });
  const lines = p.split("\n");
  assert.equal(lines[0], "(version 1)");
  assert.equal(lines[1], "(deny default)");
  const networkRules = lines.filter((l) => /network/.test(l) && l.startsWith("(allow"));
  assert.deepEqual(networkRules, ['(allow network-outbound (remote ip "localhost:4040"))']);
  const writes = lines.filter((l) => /^\(allow file-read\* file-write\*/.test(l));
  assert.deepEqual(writes, ['(allow file-read* file-write* (subpath "/srv/vyre/people/dana/site"))', '(allow file-read* file-write* (subpath "/srv/vyre/scratch/dana/s1"))']);
  assert.ok(lines.includes('(allow file-read* (subpath "/srv/vyre/people/dana/reference"))'), "the read-only folder is read only");
  assert.ok(!/\(subpath "\/"\)/.test(p) && !/\(allow default\)/.test(p));
  assert.throws(() => seatbeltProfile(checked, { proxyPort: 0 }), isPolicy);
  assert.throws(() => seatbeltProfile(checked, { proxyPort: 70000 }), isPolicy);
});

test("profile strings: quotes and backslashes are escaped, control characters are refused", () => {
  assert.equal(sbplString('a"b\\c'), '"a\\"b\\\\c"');
  assert.throws(() => sbplString("a\nb"), isPolicy);
  assert.throws(() => sbplString("a\u0000b"), isPolicy);
});

test("bwrap: new namespaces for everything, no capabilities, the person's folders only, and a network only through the proxy", () => {
  const w = bwrapCommand(hostile, ROOTS, ["claude", "--print"], { proxyPort: 4040 });
  const a = w.args;
  assert.equal(w.cmd, "bwrap");
  for (const flag of ["--die-with-parent", "--new-session", "--unshare-all", "--clearenv"]) assert.ok(a.includes(flag), flag);
  assert.deepEqual(a.slice(a.indexOf("--cap-drop"), a.indexOf("--cap-drop") + 2), ["--cap-drop", "ALL"]);
  assert.ok(!a.includes("--dev-bind") && !a.includes("--privileged"));
  for (let i = 0; i < a.length; i++) if (a[i] === "--bind" || a[i] === "--ro-bind") assert.ok(a[i + 1] !== "/" && a[i + 2] !== "/", "never the whole disk");
  assert.deepEqual(a.slice(a.indexOf("--") + 1), ["claude", "--print"]);
  assert.ok(a.includes("--share-net"));
  assert.deepEqual(w.enforcement, { files: "kernel", network: "proxy-env" });
  const env = new Map<string, string>();
  for (let i = 0; i < a.length; i++) if (a[i] === "--setenv") env.set(a[i + 1] as string, a[i + 2] as string);
  assert.equal(env.get("HTTPS_PROXY"), "http://127.0.0.1:4040");
  assert.equal(env.get("HOME"), "/home/agent");

  const offline = bwrapCommand(hostile, ROOTS, ["ls"], {});
  assert.ok(!offline.args.includes("--share-net"), "no proxy, no network");
  assert.deepEqual(offline.enforcement, { files: "kernel", network: "kernel" });
  assert.throws(() => bwrapCommand(hostile, ROOTS, [], {}), isPolicy);
});

test("the Seatbelt command is sandbox-exec with the profile, the program after --, and the proxy variables on loopback", () => {
  const w = seatbeltCommand(hostile, ROOTS, ["claude", "--print"], { proxyPort: 4040 });
  assert.equal(w.cmd, "/usr/bin/sandbox-exec");
  assert.equal(w.args[0], "-p");
  assert.ok((w.args[1] as string).startsWith("(version 1)\n(deny default)"));
  assert.deepEqual(w.args.slice(2), ["--", "claude", "--print"]);
  assert.equal(w.env["HTTPS_PROXY"], "http://127.0.0.1:4040");
  assert.deepEqual(w.enforcement, { files: "kernel", network: "kernel" });
  assert.throws(() => seatbeltCommand(mountSpec("/etc"), ROOTS, ["ls"], { proxyPort: 4040 }), isPolicy);
  assert.throws(() => seatbeltCommand(hostile, ROOTS, [], { proxyPort: 4040 }), isPolicy);
});

/** Fuzz the spec with the awkward tokens a path can be made of. Whatever passes must only ever name the person's folders in every profile built from it. */
test("fuzz: of 600 awkward mount paths, those accepted name only the person's folders in the Seatbelt profile and the bwrap arguments", () => {
  const r = rng(20261024);
  const TOKENS = ["srv", "vyre", "people", "dana", "ravi", "site", "x", "..", ".", "", ".ssh", ".aws", ".gnupg", "docker.sock", "a.sock", "etc", "%2e%2e", " ", "'", '"', "(", ")", ";", ":", "\n", "~", "\\", "é", "..."];
  const root = ROOTS.work[0] as string;
  const forbidden = new Set([".ssh", ".aws", ".gnupg", ".kube", ".docker", ".netrc"]);
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 600; i++) {
    const n = 1 + r.int(5);
    const segs = Array.from({ length: n }, () => r.pick(TOKENS));
    const host = r.int(2) === 0 ? `${root}/${segs.join("/")}` : `/${segs.join("/")}`;
    let checked;
    try { checked = validateSpec(mountSpec(host), ROOTS); } catch (e) { assert.ok(isPolicy(e), `an unexpected error for ${JSON.stringify(host)}`); refused++; continue; }
    accepted++;
    const m = checked.mounts[0]!;
    assert.ok(within(m.host, root), `${JSON.stringify(host)} became ${m.host}, outside the person's folders`);
    assert.ok(!m.host.split("/").includes(".."), m.host);
    assert.ok(!/[\u0000-\u001f"'`\\()\u007f:;]/u.test(m.host), `a character that could end a string got through: ${JSON.stringify(m.host)}`);
    assert.ok(!m.host.split("/").some((s) => forbidden.has(s)) && !m.host.endsWith(".sock"), m.host);

    const allowed = new Set([...SYSTEM_READ, "/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty", m.host]);
    const profile = seatbeltProfile(checked, { proxyPort: 4040 });
    for (const q of profile.matchAll(/\((?:subpath|literal) "((?:[^"\\]|\\.)*)"\)/g)) {
      const path = (q[1] as string).replace(/\\(.)/g, "$1");
      if (path.startsWith("localhost:")) continue;
      assert.ok(allowed.has(path), `the profile names ${path}, which is neither the system nor this person's folder`);
    }
    const w = bwrapCommand(mountSpec(host), ROOTS, ["ls"], { proxyPort: 4040 });
    for (let k = 0; k < w.args.length; k++) {
      if (w.args[k] === "--bind" || w.args[k] === "--ro-bind") assert.equal(w.args[k + 1], m.host, "bwrap binds only the mount");
    }
  }
  assert.ok(accepted >= 30 && refused >= 300, `both outcomes are exercised (${accepted} accepted, ${refused} refused)`);
});

// ---- the network

test("the proxy lets through only the hosts on the list: a tunnel to a listed host carries bytes, everything else is refused before a connection is opened", async () => {
  const up = await echoServer();
  const opened: string[] = [];
  const proxy = createEgressProxy({
    allow: ["api.anthropic.com", "*.openai.com"],
    lookup: async () => ["203.0.113.10"],
    connect: async (host, port) => { opened.push(`${host}:${port}`); const net = await import("node:net"); return net.connect(up.port, "127.0.0.1"); },
  });
  const { port } = await proxy.listen();
  try {
    const ok = await rawExchange(port, "CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n", { afterHeaders: "ping", until: /ping$/ });
    assert.match(ok, /^HTTP\/1\.1 200 Connection Established/);
    assert.ok(ok.endsWith("ping"), "bytes went through and came back");
    assert.deepEqual(opened, ["api.anthropic.com:443"]);

    const wild = await rawExchange(port, "CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n", { until: /200 Connection/ });
    assert.match(wild, /200 Connection Established/);

    const refused: Array<[string, string]> = [
      ["a host that is not listed", "evil.example.com:443"],
      ["the apex of a wildcard", "openai.com:443"],
      ["a name that only ends like a listed one", "xopenai.com:443"],
      ["a listed name as a prefix of another", "api.anthropic.com.evil.com:443"],
      ["a name that only starts like a listed one", "evilapi.anthropic.com:443"],
      ["the mail port of a listed host", "api.anthropic.com:25"],
      ["the ssh port of a listed host", "api.anthropic.com:22"],
      ["an address", "93.184.216.34:443"],
      ["localhost", "localhost:443"],
      ["the cloud metadata name", "metadata.google.internal:80"],
      ["a bracketed address", "[::1]:443"],
      ["a name with a space", "api.anthropic.com :443"],
    ];
    const before = opened.length;
    for (const [why, target] of refused) {
      const res = await rawExchange(port, `CONNECT ${target} HTTP/1.1\r\n\r\n`, { until: /\r\n\r\n/ });
      assert.match(res, /^HTTP\/1\.1 (403|400) /, why);
    }
    assert.equal(opened.length, before, "no connection was opened for any refused target");
    assert.equal(proxy.stats().denied, refused.length);
  } finally { await proxy.close(); await up.close(); }
});

test("a listed name that resolves to an inside address is refused, even if only one of its addresses is inside", async () => {
  const inside = ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1"];
  for (const ip of inside) {
    const opened: string[] = [];
    const proxy = createEgressProxy({ allow: ["api.anthropic.com"], lookup: async () => ["93.184.216.34", ip], connect: async (h) => { opened.push(h); throw new Error("must not connect"); } });
    const { port } = await proxy.listen();
    try {
      const res = await rawExchange(port, "CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n", { until: /\r\n\r\n/ });
      assert.match(res, /^HTTP\/1\.1 403 /, ip);
      assert.deepEqual(opened, [], ip);
    } finally { await proxy.close(); }
  }
});

// ---- the self-test

function fakeSandbox(leaks: ReadonlySet<string> = new Set()): Sandbox {
  const answer = (script: string): { exitCode: number; stdout: string } => {
    const says = (name: string, ok: boolean): { exitCode: number; stdout: string } => ({ exitCode: leaks.has(name) ? (ok ? 1 : 0) : (ok ? 0 : 1), stdout: "" });
    if (script === "id -u") return { exitCode: 0, stdout: leaks.has("root") ? "0\n" : "10001\n" };
    if (script === "touch /vyre-probe") return says("rootfs", false);
    if (script.includes("docker.sock")) return says("socket", false);
    if (script.includes("/proc/[0-9]*/cmdline")) return says("proc", false);
    if (script.startsWith("cat ")) return says("outside", false);
    if (script.startsWith('touch "/work/site/')) return says("rw", true);
    if (script.startsWith('touch "/work/reference/')) return says("ro", false);
    if (script.startsWith("unset HTTP_PROXY")) return says("direct", false);
    if (script.includes("evil.example.com")) return says("denied", false);
    if (script.includes("api.anthropic.com")) return says("allowed", true);
    return { exitCode: 2, stdout: "" };
  };
  return {
    id: "fake", kind: "docker", env: () => ({}),
    async exec(e) { const r = answer(e.argv[2] ?? ""); return { exitCode: r.exitCode, stdout: r.stdout, stderr: "", timedOut: false }; },
    async putCredentials() {}, async wipeCredentials() {}, async stop() {},
  };
}
const PROBE = { outsidePaths: ["/etc/shadow", "/srv/vyre/people/ravi/site/notes.md"], mounts: [{ guest: "/work/site", mode: "rw" as const }, { guest: "/work/reference", mode: "ro" as const }], deniedHost: "evil.example.com", allowedHost: "api.anthropic.com" };

test("the self-test passes a tight sandbox and names every leak of a loose one", async () => {
  assert.deepEqual(await confinementProbe(fakeSandbox(), PROBE), { ok: true, failures: [] });
  const expected: Array<[string, RegExp]> = [
    ["root", /root/], ["rootfs", /root filesystem/], ["socket", /Docker socket/], ["proc", /host's processes/], ["outside", /read \/etc\/shadow/],
    ["rw", /write in \/work\/site/], ["ro", /read-only \/work\/reference/], ["direct", /without the proxy/], ["denied", /evil\.example\.com/], ["allowed", /api\.anthropic\.com/],
  ];
  for (const [leak, re] of expected) {
    const r = await confinementProbe(fakeSandbox(new Set([leak])), PROBE);
    assert.equal(r.ok, false, leak);
    assert.ok(r.failures.some((f) => re.test(f)), `${leak}: ${JSON.stringify(r.failures)}`);
  }
});
