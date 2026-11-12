// The profiles inside the Space browser (images/space-browser/browserd/profiles.ts), with a stand-in for Chromium: one folder and one Vault channel per profile, a DevTools pipe and never a port, the idle stop, room for a new
// browser when the service is full, a person at the controls, and a profile id that cannot name a path. The real Chromium is sbrowser.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProfileManager, checkProfileId, writeDownloadPrefs } from "../../../images/space-browser/browserd/profiles.ts";
import type { LaunchFn } from "../../../images/space-browser/browserd/profiles.ts";
import type { Chrome } from "../../../images/agent-computer/agentd/chrome.ts";
import { AgentError } from "../../../images/agent-computer/agentd/errors.ts";

function rig(o: { maxRunning?: number; idleMs?: number } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sbrowser-"));
  const clock = { t: 1_000_000 };
  const launched: Array<{ dir: string; port: number | undefined; pipe: boolean; chrome: Chrome; stopped: boolean; tools: string[]; held: string[] }> = [];
  const launch: LaunchFn = (dir, _ext, _log, opts) => {
    const rec = { dir, port: opts.port, pipe: opts.pipe === true, stopped: false, tools: [] as string[], held: [] as string[], chrome: null as unknown as Chrome };
    rec.chrome = {
      port: null,
      async ready() {}, alive: () => !rec.stopped, async tabs() { return []; }, async page() { throw new Error("no page"); }, async browser() { throw new Error("no browser"); }, async attach() { throw new Error("no page"); },
      async tool(name) { rec.tools.push(name); return name === "chrome_state" ? { url: `file://${dir}`, title: path.basename(path.dirname(dir)), loading: false } : { ok: true }; },
      heldIds: () => rec.held, async extension() { return { configured: false, workers: 0 }; }, stop() { rec.stopped = true; }, async shutdown() { rec.stopped = true; },
    } as Chrome;
    launched.push(rec);
    return rec.chrome;
  };
  const m = createProfileManager({ root, extensionDir: null, log: () => {}, launch, now: () => clock.t, ...(o.maxRunning ? { maxRunning: o.maxRunning } : {}), ...(o.idleMs ? { idleMs: o.idleMs } : {}) });
  const call = (profileId: string, tool = "chrome_state", extra: Record<string, unknown> = {}) => m.tool({ profileId, tool, args: {}, timeoutMs: 5000, ...extra });
  return { m, root, clock, launched, call, done() { void m.stopAll(); fs.rmSync(root, { recursive: true, force: true }); } };
}
const refusal = (code: string) => (e: unknown) => e instanceof AgentError && e.code === code;

test("each profile has its own folder on the volume, and its browser talks over its own DevTools pipe and opens no port, so cookies and logins are separate", async () => {
  const r = rig();
  try {
    const a = await r.call("agt_dex");
    const b = await r.call("agt_scout");
    assert.equal(r.launched.length, 2);
    assert.notEqual(r.launched[0]!.dir, r.launched[1]!.dir);
    assert.deepEqual(r.launched.map((x) => [x.pipe, x.port]), [[true, undefined], [true, undefined]], "no browser is given a DevTools port: another profile's pages would reach it on the shared loopback");
    assert.equal(r.launched[0]!.dir, path.join(r.root, "profiles", "agt_dex", "chrome"));
    assert.equal(r.launched[1]!.dir, path.join(r.root, "profiles", "agt_scout", "chrome"));
    assert.ok(fs.statSync(r.launched[0]!.dir).isDirectory() && fs.statSync(r.launched[1]!.dir).isDirectory());
    assert.notEqual(a["title"], b["title"], "each answer comes from its own browser");
    await r.call("agt_dex");
    assert.equal(r.launched.length, 2, "a second tool uses the browser that is up");
    assert.ok(r.launched[0]!.tools.length === 2 && r.launched[1]!.tools.length === 1, "tools went to the right browser");
  } finally { r.done(); }
});

test("a profile id cannot name a path or another profile's folder", async () => {
  const r = rig();
  try {
    for (const bad of ["../agt_dex", "agt_dex/../x", "a/b", "", "ab", ".x", "agt dex", "a".repeat(81)]) {
      assert.throws(() => checkProfileId(bad), refusal("bad_input"), bad);
      await assert.rejects(() => r.call(bad), refusal("bad_input"), bad);
    }
    assert.equal(r.launched.length, 0);
    assert.deepEqual(fs.readdirSync(path.join(r.root)).filter((x) => x !== "profiles"), []);
  } finally { r.done(); }
});

test("a Vault channel belongs to one profile: another profile has none, and a refused handle starts no browser", async () => {
  const r = rig();
  try {
    r.m.get("agt_dex").vault.setFiller("http://vyre-host/fill", "t".repeat(24), "agt_dex");
    assert.equal(r.m.get("agt_dex").vault.hasChannel(), true);
    assert.equal(r.m.get("agt_scout").vault.hasChannel(), false);
    await assert.rejects(() => r.m.tool({ profileId: "agt_scout", tool: "chrome_fill", args: { fields: [{ ref: "e1", value: "#Dex_Site.password" }] }, timeoutMs: 5000 }), refusal("unavailable"));
    assert.equal(r.launched.length, 0, "Scout cannot fill with Dex's channel, and the refusal cost no Chromium");
  } finally { r.done(); }
});

test("a browser stops after idle and not before, never while someone watches, holds a send, or has the controls; the folder stays", async () => {
  const r = rig({ idleMs: 60_000 });
  try {
    await r.call("agt_dex");
    r.clock.t += 59_000;
    assert.deepEqual(await r.m.sweep(), []);
    r.clock.t += 2_000;
    assert.deepEqual(await r.m.sweep(), ["agt_dex"]);
    assert.equal(r.launched[0]!.stopped, true);
    assert.ok(fs.existsSync(r.launched[0]!.dir), "the profile stays on the volume");
    await r.call("agt_dex");
    assert.equal(r.launched.length, 2, "it starts again on the next use, from the same folder");
    assert.equal(r.launched[1]!.dir, r.launched[0]!.dir);
    r.m.get("agt_dex").viewers = 1;
    r.clock.t += 600_000;
    assert.deepEqual(await r.m.sweep(), [], "watching is activity");
    r.m.get("agt_dex").viewers = 0;
    r.launched[1]!.held.push("hld_1");
    assert.deepEqual(await r.m.sweep(), [], "a held send waits for its person");
    r.clock.t += 20 * 60_000;
    assert.deepEqual(await r.m.sweep(), ["agt_dex"], "but not forever");
    await r.call("agt_dex");
    r.m.takeover("agt_dex", "usr_dana");
    r.clock.t += 3_600_000;
    assert.deepEqual(await r.m.sweep(), [], "a person at the controls keeps it");
  } finally { r.done(); }
});

test("a full service closes nothing to make room: it says it is full (reason browser_full) and the Space's module decides which of its own to close (fourth look, 12 Nov)", async () => {
  const r = rig({ maxRunning: 2 });
  try {
    await r.call("agt_aaa"); r.clock.t += 1000;
    await r.call("agt_bbb"); r.clock.t += 1000;
    await assert.rejects(() => r.call("agt_ccc"), (e) => e instanceof AgentError && e.code === "unavailable" && e.reason === "browser_full" && /Every browser on this server is in use/.test(e.message));
    assert.deepEqual(r.launched.map((x) => x.stopped), [false, false], "the quiet ones were not closed by browserd");
    await r.m.stop("agt_aaa");   // the module closed one of its own
    await r.call("agt_ccc");
    assert.equal(r.launched.length, 3, "then the newcomer starts");
  } finally { r.done(); }
});
test("a person at the controls pauses the agent's tools for that profile only; the person's own tools go through; give back resumes", async () => {
  const r = rig();
  try {
    await r.call("agt_dex"); await r.call("agt_scout");
    r.m.takeover("agt_dex", "usr_dana");
    await assert.rejects(() => r.call("agt_dex"), refusal("paused"));
    await assert.rejects(() => r.call("agt_dex", "chrome_click"), refusal("paused"));
    assert.equal((await r.call("agt_dex", "chrome_status"))["ok"], true, "a look at the status is allowed");
    assert.equal((await r.call("agt_dex", "chrome_state", { by: "person" }))["loading"], false, "the person's own call goes through");
    await r.call("agt_scout");
    assert.throws(() => r.m.takeover("agt_dex", "usr_omar"), refusal("bad_input"), "one person at a time");
    r.m.takeover("agt_dex", "usr_dana");
    r.m.giveBack("agt_dex");
    await r.call("agt_dex");
  } finally { r.done(); }
});

test("stop keeps the folder, forget removes it, and status does not start a browser", async () => {
  const r = rig();
  try {
    assert.deepEqual(await r.call("agt_dex", "chrome_status"), { connected: false, paused: false, held: [] });
    assert.equal(r.launched.length, 0, "a look at a sleeping profile starts nothing");
    await r.call("agt_dex");
    await r.m.stop("agt_dex");
    assert.equal(r.launched[0]!.stopped, true);
    assert.ok(fs.existsSync(path.join(r.root, "profiles", "agt_dex")));
    await r.m.forget("agt_dex");
    assert.ok(!fs.existsSync(path.join(r.root, "profiles", "agt_dex")), "the agent was removed");
    assert.ok(fs.existsSync(path.join(r.root, "profiles")), "and nobody else's folder");
    const rows = await r.m.list();
    assert.ok(!rows.some((x) => x.profileId === "agt_dex"));
  } finally { r.done(); }
});

test("only the chrome tools run in a profile", async () => {
  const r = rig();
  try {
    await assert.rejects(() => r.call("agt_dex", "screen_click"), refusal("bad_input"));
    await assert.rejects(() => r.call("agt_dex", "computer_files_read"), refusal("bad_input"));
  } finally { r.done(); }
});

test("a profile's browser is told to save into its own downloads folder and never ask; finished downloads are listed, read and dropped, and a name cannot leave the folder", async () => {
  const r = rig();
  try {
    await r.call("agt_dex");
    const prefs = JSON.parse(fs.readFileSync(path.join(r.root, "profiles", "agt_dex", "chrome", "Default", "Preferences"), "utf8")) as { download: Record<string, unknown>; savefile: Record<string, unknown> };
    const dir = path.join(r.root, "profiles", "agt_dex", "downloads");
    assert.deepEqual([prefs.download["default_directory"], prefs.download["prompt_for_download"], prefs.savefile["default_directory"]], [dir, false, dir]);
    assert.ok(fs.statSync(dir).isDirectory());
    assert.deepEqual(r.m.downloads("agt_dex"), []);
    fs.writeFileSync(path.join(dir, "report.pdf"), "pdf bytes");
    fs.writeFileSync(path.join(dir, "half.pdf.crdownload"), "x");
    fs.writeFileSync(path.join(dir, ".hidden"), "x");
    fs.utimesSync(path.join(dir, "report.pdf"), new Date(r.clock.t - 60_000), new Date(r.clock.t - 60_000));
    const fresh = path.join(dir, "fresh.txt");
    fs.writeFileSync(fresh, "still growing");
    fs.utimesSync(fresh, new Date(r.clock.t), new Date(r.clock.t));
    assert.deepEqual(r.m.downloads("agt_dex").map((x) => x.name), ["report.pdf"], "not a partial file, a hidden one, or one written this second");
    assert.equal(r.m.downloadRead("agt_dex", "report.pdf").toString(), "pdf bytes");
    for (const bad of ["../x", "a/b", ".hidden", "x.crdownload", "", "..", "/etc/passwd"]) assert.throws(() => r.m.downloadRead("agt_dex", bad), refusal("bad_input"), bad);
    assert.throws(() => r.m.downloadRead("agt_dex", "nope.pdf"), refusal("not_found"));
    r.m.downloadAck("agt_dex", "report.pdf");
    assert.deepEqual(r.m.downloads("agt_dex"), []);
    assert.deepEqual(r.m.downloads("agt_scout"), [], "another profile has its own folder");
  } finally { r.done(); }
});

test("download preferences keep what the profile's preferences already held", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-prefs-"));
  try {
    fs.mkdirSync(path.join(root, "Default"), { recursive: true });
    fs.writeFileSync(path.join(root, "Default", "Preferences"), JSON.stringify({ intl: { selected_languages: "en" }, download: { extensions_to_open: "pdf", default_directory: "/old" } }));
    writeDownloadPrefs(root, "/data/profiles/agt_x/downloads");
    const p = JSON.parse(fs.readFileSync(path.join(root, "Default", "Preferences"), "utf8")) as { intl: unknown; download: Record<string, unknown> };
    assert.deepEqual(p.intl, { selected_languages: "en" });
    assert.deepEqual([p.download["extensions_to_open"], p.download["default_directory"], p.download["prompt_for_download"]], ["pdf", "/data/profiles/agt_x/downloads", false]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("resetChrome stops the browser and empties its Chrome folder for an import, and leaves the downloads and the rest", async () => {
  const r = rig();
  try {
    await r.call("agt_dex");
    const chrome = path.join(r.root, "profiles", "agt_dex", "chrome");
    fs.writeFileSync(path.join(chrome, "Cookies"), "old logins");
    fs.mkdirSync(path.join(r.root, "profiles", "agt_dex", "downloads"), { recursive: true });
    fs.writeFileSync(path.join(r.root, "profiles", "agt_dex", "downloads", "keep.pdf"), "x");
    await r.m.resetChrome("agt_dex");
    assert.equal(r.launched[0]!.stopped, true);
    assert.ok(!fs.existsSync(chrome));
    assert.ok(fs.existsSync(path.join(r.root, "profiles", "agt_dex", "downloads", "keep.pdf")));
    r.m.importDone("agt_dex");   // the import is in (docker.ts importChrome says so after it put the data there)
    await r.call("agt_dex");
    assert.equal(r.launched.length, 2, "it starts again, from an empty folder, or from what an import put there");
  } finally { r.done(); }
});

test("what the browser holds is noted just before it closes, and a sleeping profile is listed from that note", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sessions-"));
  const closed: string[] = [];
  try {
    const r = rig();
    const m = createProfileManager({ root, extensionDir: null, log: () => {}, launch: (dir) => ({ port: null, async ready() {}, alive: () => true, async tabs() { return []; }, async page() { throw new Error("x"); }, async tool() { return { ok: true }; }, heldIds: () => [], async extension() { return { configured: false, workers: 0 }; }, stop() {}, async shutdown() { closed.push(dir); } } as unknown as Chrome),
      onClosing: async (p) => { m.saveSessions(p.id, [{ site: "app.clio.com", since: 1, lastSeen: 2 }]); } });
    await m.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 5000 });
    assert.deepEqual(m.cachedSessions("agt_dex"), []);
    await m.stop("agt_dex");
    assert.equal(closed.length, 1);
    assert.deepEqual(m.cachedSessions("agt_dex"), [{ site: "app.clio.com", since: 1, lastSeen: 2 }]);
    assert.deepEqual(m.cachedSessions("agt_other"), []);
    r.done();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("two browsers that start at the same moment cannot both take the last place in the service", async () => {
  const r = rig({ maxRunning: 2 });
  try {
    await r.call("agt_aaa");
    // aaa is busy: hold its tool open
    const gate: Array<() => void> = [];
    const orig = r.launched[0]!.chrome.tool.bind(r.launched[0]!.chrome);
    r.launched[0]!.chrome.tool = async (n, a, s) => { await new Promise<void>((res) => gate.push(res)); return orig(n, a, s); };
    const busy = r.call("agt_aaa");
    await new Promise((res) => setTimeout(res, 10));
    const both = await Promise.allSettled([r.call("agt_bbb"), r.call("agt_ccc")]);
    const alive = r.launched.filter((x) => !x.stopped).length;
    assert.ok(alive <= 2, `never more than the service holds (${alive} running)`);
    assert.equal(both.filter((x) => x.status === "fulfilled").length, 1, "one starts");
    assert.ok(both.some((x) => x.status === "rejected" && /in use/.test(String((x as PromiseRejectedResult).reason?.message)) && (x as PromiseRejectedResult).reason?.reason === "browser_full"), "the other is told plainly, with the reason the module acts on");
    gate.forEach((g) => g());
    await busy;
  } finally { r.done(); }
});

// Audit bug 6, the part in the Space browser (12 Nov): resetChrome closed a busy browser, killing the step in flight; and a tool between the reset and the import started Chrome on the emptied folder.
test("resetChrome never closes a browser under a step in flight or a person at the controls, and no browser starts while the old computer's data goes in", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-reset-"));
  const gate: Array<() => void> = [];
  const stopped = new Set<string>();
  const starts: string[] = [];
  const launch: LaunchFn = (dir) => {
    starts.push(dir);
    return { port: null, async ready() {}, alive: () => !stopped.has(dir), async tabs() { return []; }, async page() { throw new Error("x"); }, async browser() { throw new Error("x"); }, async attach() { throw new Error("x"); },
      async tool() { await new Promise<void>((res) => gate.push(res)); return { ok: true }; }, heldIds: () => [], async extension() { return { configured: false, workers: 0 }; }, stop() { stopped.add(dir); }, async shutdown() { stopped.add(dir); } } as unknown as Chrome;
  };
  const m = createProfileManager({ root, extensionDir: null, log: () => {}, resetWaitMs: 50, launch });
  try {
    const step = m.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 5000 });
    await new Promise((res) => setTimeout(res, 20));
    await assert.rejects(() => m.resetChrome("agt_dex"), (e) => refusal("unavailable")(e) && (e as AgentError).reason === "profile_busy", "busy: refused, tried again later, with a reason that does not change with the words");
    assert.equal(stopped.size, 0, "the step's browser was not closed under it");
    gate.forEach((g) => g()); gate.length = 0;
    await step;
    m.takeover("agt_dex", "usr_dana");
    await assert.rejects(() => m.resetChrome("agt_dex"), (e) => refusal("unavailable")(e) && (e as AgentError).reason === "profile_held", "a person at the controls: refused, with its reason");
    m.giveBack("agt_dex");
    await m.resetChrome("agt_dex");
    assert.equal(stopped.size, 1, "quiet: closed and emptied");
    await assert.rejects(() => m.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 5000 }), refusal("unavailable"), "no browser starts while the data goes in");
    assert.equal(starts.length, 1);
    m.importDone("agt_dex");
    const next = m.tool({ profileId: "agt_dex", tool: "chrome_state", args: {}, timeoutMs: 5000 });
    await new Promise((res) => setTimeout(res, 20));
    gate.forEach((g) => g());
    await next;
    assert.equal(starts.length, 2, "and it starts again once the data is in");
  } finally { gate.forEach((g) => g()); await m.stopAll(); fs.rmSync(root, { recursive: true, force: true }); }
});

// Review (12 Nov): every click, act, open, type and send waited 300 ms for a download that might begin, even when none did.
test("a step that sets off no download waits for nothing after it", async () => {
  const r = rig();
  try {
    await r.call("agt_dex", "chrome_state");
    for (const name of ["chrome_click", "chrome_act", "chrome_open", "chrome_type", "chrome_send"]) {
      const t0 = performance.now();
      await r.call("agt_dex", name);
      const ms = performance.now() - t0;
      assert.ok(ms < 100, `${name} took ${Math.round(ms)} ms with no download`);
    }
  } finally { r.done(); }
});

// Third look (12 Nov): a dead MJPEG view of a still page was never closed (no frame, so no full socket) and kept the holder's takeover going. Only a WebSocket view, which the relay pings, counts.
test("only the holder's WebSocket views count as their open view; an MJPEG view never does", async () => {
  const { startViewServer } = await import("../../../images/space-browser/browserd/view.ts");
  const port = 21000 + Math.floor(Math.random() * 20000);
  // one frame at once, then a still page: nothing more
  const hub = { watch: (f: (j: Buffer) => void) => { f(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); return () => undefined; }, viewers: () => 0, lastFrameAt: () => null, latest: () => null };
  const views = startViewServer({ port, address: () => "127.0.0.1", viewOf: () => ({ hub, input: { call: async () => ({ x: 0, y: 0 }) }, takenOver: () => true, onInput: () => undefined }) });
  try {
    await new Promise((r) => setTimeout(r, 50));
    const ac = new AbortController();
    const res = await fetch(views.url(views.mint("agt_dex", "usr_dana"), "mjpeg"), { signal: ac.signal });
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(views.viewersOf("agt_dex", "usr_dana"), 0, "an MJPEG view is not counted");
    const ws = new WebSocket(views.url(views.mint("agt_dex", "usr_dana"), "ws"));
    await new Promise<void>((r) => ws.addEventListener("open", () => r()));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(views.viewersOf("agt_dex", "usr_dana"), 1, "a WebSocket view is");
    ws.close(); ac.abort();
    for (let i = 0; i < 40 && views.viewersOf("agt_dex", "usr_dana") > 0; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(views.viewersOf("agt_dex", "usr_dana"), 0, "and stops counting when it closes");
  } finally { views.close(); }
});

// Third look (12 Nov): give back released with no time, so a takeover by another person that reached browserd first was cleared by it.
test("a release carries the time it was decided: browserd never undoes a takeover that began after it", async () => {
  const r = rig();
  try {
    await r.call("agt_dex");
    const decided = r.clock.t;
    r.clock.t += 1000;
    r.m.takeover("agt_dex", "usr_omar");             // Omar takes over after Dana's give back was decided
    r.m.giveBack("agt_dex", decided);                // Dana's release reaches browserd late
    await assert.rejects(() => r.call("agt_dex"), refusal("paused"), "Omar still has the controls");
    r.m.giveBack("agt_dex", r.clock.t + 1);
    await r.call("agt_dex");
  } finally { r.done(); }
});

// Owner, 12 Nov: how many browsers run at once comes from memory, not a fixed six; an admin's number is an upper bound only.
test("browserd runs as many browsers as its memory holds (256 MB each after 512 MB for itself); an admin's number only caps it", async () => {
  const { memoryLimitMb, slotsFor } = await import("../../../images/space-browser/browserd/profiles.ts");
  assert.equal(slotsFor(8192, undefined), 30, "an 8 GB container: thirty");
  assert.equal(slotsFor(2560, undefined), 8);
  assert.equal(slotsFor(600, undefined), 1, "never none");
  assert.equal(slotsFor(8192, 6), 6, "the admin's bound");
  assert.equal(slotsFor(2560, 50), 8, "a bound above what memory holds changes nothing");
  assert.equal(memoryLimitMb((f) => (f.endsWith("memory.max") ? "4294967296\n" : ""), () => 16000), 4096, "cgroup v2");
  assert.equal(memoryLimitMb((f) => { if (f.endsWith("memory.max")) return "max\n"; throw new Error("no"); }, () => 16000), 16000, "no limit: the computer's memory");
  assert.equal(memoryLimitMb((f) => { if (f.endsWith("memory.max")) throw new Error("v1"); return "2147483648"; }, () => 16000), 2048, "cgroup v1");
});

test("the container's process cap limits how many browsers run too (a Chromium is about 120 tasks), and a browser that cannot be made is a refusal, not a crash", async () => {
  const { slotsFor, pidsLimit } = await import("../../../images/space-browser/browserd/profiles.ts");
  assert.equal(slotsFor(8192, undefined, 2048), 16, "2048 tasks: sixteen, though memory holds thirty");
  assert.equal(slotsFor(8192, undefined, 3700), 30);
  assert.equal(slotsFor(8192, undefined, null), 30, "no cap: memory decides");
  assert.equal(pidsLimit((f) => (f.endsWith("pids.max") && !f.includes("/pids/") ? "2048\n" : "")), 2048);
  assert.equal(pidsLimit((f) => (f.includes("/pids/") ? "" : "max\n")), null);
});

// Fifth look 1: the Space a profile belongs to is written in its folder, so a purge of one install removes only that Space's profiles, from what is on disk, with their browsers closed cleanly first.
test("purge_space removes only this Space's profiles (closed first) and counts what else is on the volume; the Space is kept on disk across a restart of browserd", async () => {
  const r = rig();
  try {
    r.m.setSpace("agt_mine", "spc_a"); await r.call("agt_mine");
    r.m.setSpace("agt_theirs", "spc_b"); await r.call("agt_theirs");
    fs.mkdirSync(path.join(r.root, "profiles", "agt_old"), { recursive: true });   // made before Spaces were written down
    // a browserd that starts again knows each profile's Space from its folder
    const again = createProfileManager({ root: r.root, extensionDir: null, log: () => {}, launch: () => { throw new Error("no start"); } });
    assert.equal(again.get("agt_theirs").spaceId, "spc_b");
    const got = await r.m.purgeSpace("spc_a");
    assert.deepEqual(got, { removed: 1, others: 1, unmarked: 1 });
    assert.equal(r.launched[0]!.stopped, true, "this Space's browser was closed before its folder went");
    assert.equal(fs.existsSync(path.join(r.root, "profiles", "agt_mine")), false);
    assert.equal(fs.existsSync(path.join(r.root, "profiles", "agt_theirs", "chrome")), true, "another Space's sign-ins stay");
    assert.equal(r.launched[1]!.stopped, false, "and its browser runs on");
  } finally { r.done(); }
});

// Fifth look 2: every answer says which start of the browser it came from; an act on refs taken under an older start is refused, every time, with the line.
test("each start of a browser has its own id on every answer, and an act on refs from an older start is refused with the line", async () => {
  const r = rig({ idleMs: 1000 });
  try {
    await r.call("agt_dex");
    const first = r.m.get("agt_dex").startId;
    assert.match(first, /^[a-z0-9]+\.\d+$/);
    await r.call("agt_dex", "chrome_click", { refsFrom: first });
    await r.m.stop("agt_dex");
    const stale = (e: unknown) => e instanceof AgentError && e.reason === "browser_reopened" && /Take a new snapshot before you click/.test(e.message);
    await assert.rejects(() => r.call("agt_dex", "chrome_click", { refsFrom: first }), stale, "the browser started again for this call: the refs are from before");
    await assert.rejects(() => r.call("agt_dex", "chrome_click", { refsFrom: first }), stale, "and again, until a new snapshot");
    assert.notEqual(r.m.get("agt_dex").startId, first);
    await r.call("agt_dex", "chrome_click", { refsFrom: r.m.get("agt_dex").startId });
    assert.equal(r.launched[1]!.tools.filter((t) => t === "chrome_click").length, 1, "the refused acts never reached the browser");
  } finally { r.done(); }
});

// Fifth look, cross-Space: a Space whose own browsers are all in use, on a container full of another Space's idle ones, asks browserd to close the longest quiet of those, by the 90 s rule.
test("close_other closes another Space's longest quiet browser past the grace, never the asker's own, a busy, watched or held one, or one quiet for less", async () => {
  const r = rig();
  try {
    r.m.setSpace("agt_b1", "spc_b"); await r.call("agt_b1"); r.clock.t += 1000;
    r.m.setSpace("agt_b2", "spc_b"); await r.call("agt_b2"); r.clock.t += 1000;
    r.m.setSpace("agt_a1", "spc_a"); await r.call("agt_a1");
    assert.equal(await r.m.closeOther("spc_a", 90_000), null, "quiet for 2 s: not yet");
    r.clock.t += 120_000;
    r.launched[0]!.held.push("held_1");   // agt_b1 holds a send for its person
    assert.equal(await r.m.closeOther("spc_a", 90_000), "agt_b2", "the held one stays; the other goes");
    assert.equal(r.launched[2]!.stopped, false, "the asker's own Space is never closed this way");
  } finally { r.done(); }
});

// Sixth look 1, browserd's side: an act naming an older start (or any start while the browser is not running) is refused before the Vault is asked for a value and before a browser starts.
test("an act on a start that is not the one running is refused before the Vault is asked and before a browser starts; with the start running it goes on", async () => {
  const r = rig();
  try {
    await r.call("agt_dex");
    const first = r.m.get("agt_dex").startId;
    let asked = 0;
    const channel = { fillArgs: async (a: Record<string, unknown>) => { asked += 1; return { args: a, used: [] }; } } as unknown as Parameters<typeof r.m.tool>[0]["channel"];
    await r.m.tool({ profileId: "agt_dex", tool: "chrome_type", args: { text: "#Acme.password" }, timeoutMs: 5000, seenFrom: first, ...(channel ? { channel } : {}) });
    assert.equal(asked, 1);
    await r.m.stop("agt_dex");
    const stale = (e: unknown) => e instanceof AgentError && e.reason === "browser_reopened" && e.start === null;
    await assert.rejects(() => r.m.tool({ profileId: "agt_dex", tool: "chrome_type", args: { text: "#Acme.password" }, timeoutMs: 5000, seenFrom: first, ...(channel ? { channel } : {}) }), stale);
    assert.equal(asked, 1, "the Vault was not asked");
    assert.equal(r.launched.length, 1, "no browser started for it");
    await r.call("agt_dex");   // a look starts it again
    const e2 = await r.m.tool({ profileId: "agt_dex", tool: "chrome_click", args: {}, timeoutMs: 5000, seenFrom: first }).catch((e: unknown) => e);
    assert.ok(e2 instanceof AgentError && e2.start === r.m.get("agt_dex").startId, "the refusal names the start now running");
    await r.m.tool({ profileId: "agt_dex", tool: "chrome_click", args: {}, timeoutMs: 5000, seenFrom: r.m.get("agt_dex").startId });
  } finally { r.done(); }
});

// Sixth look, should-fix B: a Space's daemon marks its own profiles at its start, a sleeping agent's included, so they are found as this Space's on disk.
test("mark_space writes the Space into this Space's own profiles on disk that name none, never one another Space marked, and makes no folder", async () => {
  const r = rig();
  try {
    fs.mkdirSync(path.join(r.root, "profiles", "agt_sleeps"), { recursive: true });
    r.m.setSpace("agt_theirs", "spc_b"); await r.call("agt_theirs");
    assert.equal(r.m.markSpace("spc_a", ["agt_sleeps", "agt_theirs", "agt_never"]), 1);
    assert.equal(fs.readFileSync(path.join(r.root, "profiles", "agt_sleeps", "space"), "utf8"), "spc_a");
    assert.equal(fs.readFileSync(path.join(r.root, "profiles", "agt_theirs", "space"), "utf8"), "spc_b", "another Space's mark stays");
    assert.equal(fs.existsSync(path.join(r.root, "profiles", "agt_never")), false, "no folder is made for a profile that has none");
    assert.deepEqual(await r.m.purgeSpace("spc_a"), { removed: 1, others: 1, unmarked: 0 });
  } finally { r.done(); }
});

// Sixth look C, browserd's side: a person's view or takeover is remembered (when, and which start they saw); one who takes over a browser that was reopened since is told.
test("a person's view and takeover are remembered; taking over a browser reopened since that person last saw it says so", async () => {
  const r = rig();
  try {
    await r.call("agt_dex");
    r.m.personSaw("agt_dex");
    const row = (await r.m.list()).find((x) => x.profileId === "agt_dex")!;
    assert.equal(row.personSeenAt, r.clock.t, "the row says when a person last had it in front of them");
    assert.deepEqual(r.m.takeover("agt_dex", "usr_dana"), { reopened: false }, "the same start they saw");
    r.m.giveBack("agt_dex");
    await r.m.stop("agt_dex");
    await r.call("agt_dex");   // reopened for the agent's next step
    assert.deepEqual(r.m.takeover("agt_dex", "usr_dana"), { reopened: true }, "the page they saw was reloaded since");
  } finally { r.done(); }
});

// Seventh look: the reopen check must hold across the Vault lookup. The browser is busy while the value is fetched (no sweep closes it), and a close that lands anyway (a forced stop) is caught after
// the browser is there again: the act is refused and the value never reaches the page; busy returns to zero.
test("while a #Handle is fetched the browser is busy (the idle sweep leaves it); a close that lands meanwhile is caught after the start: refused, nothing typed, busy back to zero", async () => {
  const r = rig({ idleMs: 1000 });
  try {
    await r.call("agt_dex");
    const first = r.m.get("agt_dex").startId;
    let release!: () => void;
    const fetched = new Promise<void>((res) => { release = res; });
    const channel = { fillArgs: async (a: Record<string, unknown>) => { await fetched; return { args: { ...a, text: "s3cret" }, used: [] }; } } as unknown as Parameters<typeof r.m.tool>[0]["channel"];
    const typing = r.m.tool({ profileId: "agt_dex", tool: "chrome_type", args: { text: "#Acme.password" }, timeoutMs: 5000, seenFrom: first, ...(channel ? { channel } : {}) });
    await new Promise((res) => setTimeout(res, 10));
    r.clock.t += 10 * 60_000;
    assert.deepEqual(await r.m.sweep(), [], "busy while the value is fetched: the idle sweep leaves it");
    assert.equal(r.m.get("agt_dex").state.busy, 1);
    await r.m.stop("agt_dex");   // a close that lands anyway
    release();
    await assert.rejects(typing, (e) => e instanceof AgentError && e.reason === "browser_reopened");
    assert.equal(r.m.get("agt_dex").state.busy, 0, "busy returns to zero");
    assert.ok(!r.launched.some((l) => l.tools.includes("chrome_type")), "the value never reached a page");
  } finally { r.done(); }
});

// Seventh look, C per person: the start each person last saw is their own, so a second person who takes over after a reopen is told too.
test("the reopened note on takeover is per person: each who saw the old page is told", async () => {
  const r = rig();
  try {
    await r.call("agt_dex");
    r.m.personSaw("agt_dex", "usr_ann"); r.m.personSaw("agt_dex", "usr_bob");
    await r.m.stop("agt_dex"); await r.call("agt_dex");
    assert.deepEqual(r.m.takeover("agt_dex", "usr_ann"), { reopened: true });
    r.m.giveBack("agt_dex");
    assert.deepEqual(r.m.takeover("agt_dex", "usr_bob"), { reopened: true }, "Ann's takeover did not use up Bob's notice");
    r.m.giveBack("agt_dex");
    assert.deepEqual(r.m.takeover("agt_dex", "usr_ann"), { reopened: false }, "the same start Ann saw last");
  } finally { r.done(); }
});
