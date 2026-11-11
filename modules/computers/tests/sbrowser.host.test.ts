// The Docker adapter of the Space browser against a scripted Engine: one container for the Space host made on the first tool, started once, driven by one `docker exec <container> /opt/browserd/ctl ...` per call.
// Its config is held to the same profile as an agent computer (no capability, no Docker socket, only its own volume).
import test from "node:test";
import assert from "node:assert/strict";
import type { ContainerConfig, DockerApi } from "../../../sandbox/src/docker.ts";
import { reviewComputerConfig } from "../impl.ts";
import { BROWSERD_CTL, browserContainerConfig, createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { ToolError } from "../handlers/tools/common.ts";

type Exec = { exitCode: number | null; stdout: string; stderr: string };
function engine(onCtl: (action: string, body: Record<string, unknown>) => Exec, o: { image?: boolean } = {}) {
  const created: Array<{ name: string; config: ContainerConfig }> = [];
  const execs: Array<{ name: string; cmd: readonly string[]; user?: string }> = [];
  const running = new Set<string>();
  let starts = 0;
  const api: DockerApi = {
    async ping() { return true; },
    async imageExists() { return o.image !== false; },
    async networkCreate() { throw new Error("no networks"); }, async networkRemove() { throw new Error("no networks"); },
    async containerCreate(name, config) { created.push({ name, config }); return `id-${name}`; },
    async containerStart(id) { starts += 1; running.add(id.replace(/^id-/, "")); },
    async containerStop(id) { running.delete(id); }, async containerRemove(id) { running.delete(id); },
    async containerRunning(id) { return running.has(id.replace(/^id-/, "")); },
    async exec(name, a) { execs.push({ name, cmd: a.cmd, ...(a.user ? { user: a.user } : {}) }); return onCtl(String(a.cmd[1]), JSON.parse(String(a.cmd[2]))); },
    async putArchive() {},
  };
  return { api, created, execs, get starts() { return starts; } };
}
const ok = (v: unknown): Exec => ({ exitCode: 0, stdout: `${JSON.stringify(v)}\n`, stderr: "" });

test("the first tool makes and starts the one container, waits for browserd, then asks it; the second tool reuses it", async () => {
  const e = engine((action) => (action === "status" ? ok({ profiles: [] }) : ok({ url: "https://example.com/", title: "T", loading: false })));
  const sb = createDockerSpaceBrowser({ api: e.api, user: { uid: 10001, gid: 10001 }, sleep: async () => {} });
  const out = await sb.tool({ profileId: "agt_dex", tool: "chrome_state", args: { tabId: "t1" }, timeoutMs: 1000 });
  assert.deepEqual(out, { url: "https://example.com/", title: "T", loading: false });
  assert.equal(e.created.length, 1);
  assert.equal(e.created[0]!.name, "vyre-sbrowser");
  assert.equal(e.starts, 1);
  const tool = e.execs.find((x) => x.cmd[1] === "tool")!;
  assert.equal(tool.cmd[0], BROWSERD_CTL);
  assert.equal(tool.user, "10001:10001");
  assert.deepEqual(JSON.parse(String(tool.cmd[2])), { profileId: "agt_dex", tool: "chrome_state", args: { tabId: "t1" }, timeoutMs: 1000 });
  await sb.tool({ profileId: "agt_scout", tool: "chrome_state", args: {}, timeoutMs: 1000 });
  assert.equal(e.created.length, 1, "one service for the Space host, not one per agent");
  assert.equal(e.starts, 1);
});

test("available is whether the container runtime answers; behind the runner the service has its own network, with the ingress joined, and a missing image is fetched", async () => {
  const e = engine(() => ok({}), { image: false });
  const pulled: string[] = [];
  const reqs: Array<{ method: string; path: string; json?: unknown }> = [];
  const http = async (r: { method: string; path: string; query?: Record<string, string>; json?: unknown }) => {
    reqs.push({ method: r.method, path: r.path, ...(r.json !== undefined ? { json: r.json } : {}) });
    if (r.path === "/images/create") { pulled.push(JSON.stringify(r.query)); (e as unknown as { gotImage: boolean }).gotImage = true; }
    return { status: r.path.startsWith("/networks/create") ? 201 : 200, body: new Uint8Array() };
  };
  const api = { ...e.api, async imageExists() { return (e as unknown as { gotImage?: boolean }).gotImage === true; } };
  const sb = createDockerSpaceBrowser({ api, http, runner: { ingress: "vyre-vyred", alias: "vyre-host" }, image: "ghcr.io/vyre-ai/space-browser:1.2", sleep: async () => {} });
  assert.equal(await sb.available(), true);
  await sb.tool({ profileId: "agt_dex", tool: "chrome_status", args: {}, timeoutMs: 1000 });
  assert.deepEqual(pulled, [JSON.stringify({ fromImage: "ghcr.io/vyre-ai/space-browser", tag: "1.2" })]);
  const net = reqs.find((r) => r.path === "/networks/create")!;
  assert.deepEqual(net.json, { Name: "vyre-sbrowsernet", Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" } });
  const join = reqs.find((r) => r.path === "/networks/vyre-sbrowsernet/connect")!;
  assert.deepEqual(join.json, { Container: "vyre-vyred", EndpointConfig: { Aliases: ["vyre-host"] } });
  assert.equal(e.created[0]!.config.HostConfig.NetworkMode, "vyre-sbrowsernet");
  assert.deepEqual(reviewComputerConfig(e.created[0]!.config), []);
  const down = createDockerSpaceBrowser({ api: { ...e.api, async ping() { return false; } } });
  assert.equal(await down.available(), false);
});

test("calls that arrive together start the container once", async () => {
  const e = engine(() => ok({}));
  const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
  await Promise.all(["agt_a1", "agt_b2", "agt_c3"].map((profileId) => sb.tool({ profileId, tool: "chrome_status", args: {}, timeoutMs: 1000 })));
  assert.equal(e.created.length, 1);
  assert.equal(e.starts, 1);
});

test("the Vault channel and a person at the controls go with the call, to browserd, for that profile", async () => {
  const e = engine(() => ok({ ok: true }));
  const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
  await sb.tool({ profileId: "agt_dex", tool: "chrome_fill", args: { fields: [] }, timeoutMs: 1000, fill: { url: "http://vyre-host/fill", token: "t".repeat(24) }, by: "person" });
  const body = JSON.parse(String(e.execs.find((x) => x.cmd[1] === "tool")!.cmd[2]));
  assert.deepEqual([body.profileId, body.fillUrl, body.fillToken, body.by], ["agt_dex", "http://vyre-host/fill", "t".repeat(24), "person"]);
  await sb.takeover({ profileId: "agt_dex", personId: "usr_dana" });
  await sb.giveBack("agt_dex");
  const seen = e.execs.map((x) => `${x.cmd[1]} ${JSON.parse(String(x.cmd[2])).profileId ?? ""}`);
  assert.ok(seen.includes("takeover agt_dex") && seen.includes("give_back agt_dex"));
});

test("a refusal printed by browserd keeps its code; anything else is an unavailable browser; a missing image says what to do", async () => {
  for (const code of ["timeout", "paused", "not_found", "bad_input", "held", "unavailable"] as const) {
    const e = engine((action) => (action === "status" ? ok({}) : { exitCode: 1, stdout: "", stderr: `noise\n${JSON.stringify({ code, message: `said ${code}` })}\n` }));
    const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
    await assert.rejects(() => sb.tool({ profileId: "agt_dex", tool: "chrome_click", args: {}, timeoutMs: 1000 }), (x) => x instanceof ToolError && x.code === code && x.message === `said ${code}`);
  }
  const odd = createDockerSpaceBrowser({ api: engine((a) => (a === "status" ? ok({}) : { exitCode: 139, stdout: "", stderr: "Segmentation fault" })).api, sleep: async () => {} });
  await assert.rejects(() => odd.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 1000 }), (x) => x instanceof ToolError && x.code === "unavailable" && /139/.test(x.message));
  const noImage = createDockerSpaceBrowser({ api: engine(() => ok({}), { image: false }).api, sleep: async () => {} });
  await assert.rejects(() => noImage.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 1000 }), (x) => x instanceof ToolError && x.code === "unavailable" && /image/.test(x.message));
});

test("a browserd that never answers is an unavailable browser after the start time, not a hang", async () => {
  const e = engine(() => ({ exitCode: 3, stdout: "", stderr: "browserd is not answering" }));
  const sb = createDockerSpaceBrowser({ api: e.api, startTimeoutMs: 50, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
  await assert.rejects(() => sb.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 1000 }), (x) => x instanceof ToolError && x.code === "unavailable" && /did not answer in time/.test(x.message));
});

test("the container is held to the computer profile: no capability, no new privileges, no Docker socket, only its own volume, limits set", () => {
  const c = browserContainerConfig({ api: {} as DockerApi });
  assert.deepEqual(reviewComputerConfig(c), []);
  assert.deepEqual(c.HostConfig.Binds, ["vyre-sbrowser-data:/data:rw"]);
  assert.equal(c.HostConfig.CapDrop[0], "ALL");
  assert.ok(c.HostConfig.Tmpfs["/tmp"]!.includes("noexec"));
  assert.ok(c.HostConfig.Memory > 0 && c.HostConfig.PidsLimit > 0);
  assert.ok(!c.Env.some((x) => /TOKEN|SECRET|KEY/i.test(x)), "no secret in the environment");
  const small = browserContainerConfig({ api: {} as DockerApi, limits: { memoryMb: 1024, cpus: 1 }, maxRunning: 2, idleMinutes: 3, name: "vyre-sbrowser-x" });
  assert.equal(small.HostConfig.Memory, 1024 * 1024 * 1024);
  assert.deepEqual(small.Env, ["VYRE_BROWSER_MAX_RUNNING=2", "VYRE_BROWSER_IDLE_MINUTES=3"]);
  assert.deepEqual(small.HostConfig.Binds, ["vyre-sbrowser-x-data:/data:rw"]);
});

test("stop does nothing when the container is not running, forget starts it to remove a deleted agent's folder (its sign-ins must not stay), and profiles lists what browserd says", async () => {
  const e = engine((a) => (a === "status" ? ok({ profiles: [{ profileId: "agt_dex", running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: 1, held: 0, paused: false }], maxRunning: 4 }) : ok({})));
  const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
  await sb.stop("agt_dex");
  assert.equal(e.execs.length, 0);
  assert.deepEqual(await sb.profiles(), { profiles: [], maxRunning: 6 });
  await sb.forget("agt_gone");
  assert.equal(e.starts, 1, "the service started for the removal");
  assert.ok(e.execs.some((x) => x.cmd[1] === "forget" && JSON.parse(String(x.cmd[2])).profileId === "agt_gone"), "and the folder was removed");
  await sb.tool({ profileId: "agt_dex", tool: "chrome_status", args: {}, timeoutMs: 1000 });
  const p = await sb.profiles();
  assert.equal(p.profiles[0]!.profileId, "agt_dex");
  assert.equal(p.maxRunning, 4);
  await sb.forget("agt_dex");
  assert.ok(e.execs.some((x) => x.cmd[1] === "forget"));
});

test("downloads: listed without starting the container, read and dropped by one exec each", async () => {
  const e = engine((action, body) => {
    if (action === "downloads") return ok({ downloads: [{ name: "a.pdf", size: 3, at: 5 }] });
    if (action === "download_read") return ok({ base64: Buffer.from(`file ${String(body["name"])}`).toString("base64") });
    return ok({});
  });
  const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
  assert.deepEqual(await sb.downloads("agt_dex"), []);
  assert.equal(e.execs.length, 0, "a container that is not running has no downloads and is not started");
  await sb.tool({ profileId: "agt_dex", tool: "chrome_status", args: {}, timeoutMs: 1000 });
  assert.deepEqual(await sb.downloads("agt_dex"), [{ name: "a.pdf", size: 3, at: 5 }]);
  assert.equal(Buffer.from(await sb.downloadRead("agt_dex", "a.pdf")).toString(), "file a.pdf");
  await sb.downloadAck("agt_dex", "a.pdf");
  const seen = e.execs.map((x) => `${x.cmd[1]} ${JSON.parse(String(x.cmd[2])).name ?? ""}`.trim());
  assert.deepEqual(seen.slice(-3), ["downloads", "download_read a.pdf", "download_ack a.pdf"]);
});

test("Chrome's data of an old computer replaces the profile's: the folder is emptied inside the service, the tar goes into the profile's own folder, and nothing else is touched", async () => {
  const e = engine(() => ok({}));
  const puts: Array<{ id: string; dir: string; bytes: number }> = [];
  const api = { ...e.api, async putArchive(id: string, dir: string, tar: Uint8Array) { puts.push({ id, dir, bytes: tar.length }); } };
  const sb = createDockerSpaceBrowser({ api, sleep: async () => {} });
  const r = await sb.importChrome("agt_dex", new Uint8Array([1, 2, 3]));
  assert.deepEqual(r, { bytes: 3 });
  assert.deepEqual(puts, [{ id: "vyre-sbrowser", dir: "/data/profiles/agt_dex", bytes: 3 }]);
  assert.ok(e.execs.some((x) => x.cmd[1] === "reset_chrome" && JSON.parse(String(x.cmd[2])).profileId === "agt_dex"));
});

test("the container's limits grow with how many browsers it holds, within what the runner allows", () => {
  const six = browserContainerConfig({ api: {} as DockerApi });
  assert.equal(six.HostConfig.Memory, (512 + 6 * 512) * 1024 * 1024);
  assert.equal(six.HostConfig.NanoCpus, 3e9);
  const huge = browserContainerConfig({ api: {} as DockerApi, maxRunning: 40 });
  assert.equal(huge.HostConfig.Memory, 8192 * 1024 * 1024, "never above the runner's cap");
  assert.equal(huge.HostConfig.NanoCpus, 4e9);
  assert.deepEqual(reviewComputerConfig(huge), []);
});

test("with Engine access and no runner the service gets a network of its own, names the host on it for the Vault channel, and the daemon learns its subnet", async () => {
  const e = engine(() => ok({}));
  const reqs: Array<{ method: string; path: string; json?: unknown }> = [];
  const http = async (r: { method: string; path: string; json?: unknown }) => {
    reqs.push({ method: r.method, path: r.path, ...(r.json !== undefined ? { json: r.json } : {}) });
    if (r.method === "GET" && r.path === "/networks/vyre-sbrowsernet") return { status: 200, body: new TextEncoder().encode(JSON.stringify({ IPAM: { Config: [{ Subnet: "172.29.0.0/16", Gateway: "172.29.0.1" }] } })) };
    return { status: r.path === "/networks/create" ? 201 : 200, body: new Uint8Array() };
  };
  const sb = createDockerSpaceBrowser({ api: e.api, http, sleep: async () => {} });
  await sb.tool({ profileId: "agt_dex", tool: "chrome_status", args: {}, timeoutMs: 1000 });
  const c = e.created[0]!.config;
  assert.equal(c.HostConfig.NetworkMode, "vyre-sbrowsernet", "not the default bridge, beside every other container and the host");
  assert.deepEqual(c.HostConfig.ExtraHosts, ["host.docker.internal:172.29.0.1"], "the daemon is reached at the network's own gateway, where it knows the caller");
  assert.ok(!reqs.some((r) => r.path.endsWith("/connect")), "no ingress joins without the runner");
  assert.deepEqual(sb.subnets?.(), ["172.29.0.0/16"]);
  const { bindSpaceBrowser } = await import("../sbrowser/port.ts");
  const { computerSubnets } = await import("../impl.ts");
  bindSpaceBrowser(sb);
  try { assert.ok(computerSubnets().includes("172.29.0.0/16"), "a request from the Space browser reaches only the Vault channel of the daemon"); } finally { bindSpaceBrowser(null); }
  assert.deepEqual(reviewComputerConfig(c), []);
});

// Review finding 4 (12 Nov): a call was repeated whenever the error said "not answering", which ctl also printed after the request was sent. Only a request that never reached browserd is asked again.
test("a call is asked again only when ctl says browserd was not up (nothing was sent); one lost after it was sent is an error, never repeated", async () => {
  for (const [stderr, again] of [
    [{ code: "unavailable", message: "browserd is not up yet: connect ENOENT /tmp/browserd.sock" }, true],
    [{ code: "unavailable", message: "browserd stopped while it worked on the request: read ECONNRESET" }, false],
    [{ code: "unavailable", message: "browserd is not answering: write EPIPE" }, false],
  ] as const) {
    let tools = 0;
    const e = engine((action) => {
      if (action === "status") return ok({});
      tools += 1;
      return tools === 1 ? { exitCode: 3, stdout: "", stderr: `${JSON.stringify(stderr)}\n` } : ok({ ok: true });
    });
    const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
    const r = await sb.tool({ profileId: "agt_dex", tool: "chrome_click", args: { ref: "e1" }, timeoutMs: 1000 }).then(() => "done", (x: unknown) => (x as Error).message);
    assert.equal(tools, again ? 2 : 1, `${stderr.message}: sent ${tools} times`);
    assert.equal(r === "done", again, stderr.message);
  }
});

test("ctl says whether the request was sent: no socket is 'not up yet' (exit 3), a browserd that drops the request is 'stopped while it worked' (exit 4)", async () => {
  const { spawnSync, spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const ctl = path.join(path.dirname(new URL(import.meta.url).pathname), "../../../images/space-browser/browserd/ctl");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctl-"));
  try {
    const none = spawnSync(process.execPath, [ctl, "tool", "{}"], { env: { ...process.env, VYRE_BROWSERD_SOCKET: path.join(dir, "absent.sock") }, encoding: "utf8" });
    assert.equal(none.status, 3);
    assert.match(none.stderr, /browserd is not up yet/);
    const sockPath = path.join(dir, "b.sock");
    const server = createServer((c) => { c.once("data", () => c.destroy()); });
    await new Promise<void>((r) => server.listen(sockPath, () => r()));
    const out = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const p = spawn(process.execPath, [ctl, "tool", "{}"], { env: { ...process.env, VYRE_BROWSERD_SOCKET: sockPath } });
      let err = ""; p.stderr.on("data", (d: Buffer) => { err += d.toString(); });
      p.on("exit", (status) => resolve({ status, stderr: err }));
    });
    server.close();
    assert.equal(out.status, 4, out.stderr);
    assert.match(out.stderr, /browserd stopped while it worked on the request/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
