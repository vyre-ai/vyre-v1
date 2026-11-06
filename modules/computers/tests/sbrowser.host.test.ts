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

test("stop and forget do nothing when the container is not running; profiles lists what browserd says", async () => {
  const e = engine((a) => (a === "status" ? ok({ profiles: [{ profileId: "agt_dex", running: true, tabs: 1, busy: false, takeover: false, viewers: 0, lastActiveAt: 1, held: 0, paused: false }], maxRunning: 4 }) : ok({})));
  const sb = createDockerSpaceBrowser({ api: e.api, sleep: async () => {} });
  await sb.stop("agt_dex"); await sb.forget("agt_dex");
  assert.equal(e.execs.length, 0);
  assert.deepEqual(await sb.profiles(), { profiles: [], maxRunning: 6 });
  await sb.tool({ profileId: "agt_dex", tool: "chrome_status", args: {}, timeoutMs: 1000 });
  const p = await sb.profiles();
  assert.equal(p.profiles[0]!.profileId, "agt_dex");
  assert.equal(p.maxRunning, 4);
  await sb.forget("agt_dex");
  assert.ok(e.execs.some((x) => x.cmd[1] === "forget"));
});
