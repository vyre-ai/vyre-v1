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

test("a full service stops the quietest idle browser for a new one, and says plainly when every one is busy", async () => {
  const r = rig({ maxRunning: 2 });
  try {
    await r.call("agt_aaa"); r.clock.t += 1000;
    await r.call("agt_bbb"); r.clock.t += 1000;
    await r.call("agt_ccc");
    assert.equal(r.launched[0]!.stopped, true, "the longest quiet one made room");
    assert.equal(r.launched[1]!.stopped, false);
    // both remaining are busy: hold the tools open
    const gate: Array<() => void> = [];
    for (const l of r.launched.filter((x) => !x.stopped)) {
      const orig = l.chrome.tool.bind(l.chrome);
      l.chrome.tool = async (n, a, s) => { await new Promise<void>((res) => gate.push(res)); return orig(n, a, s); };
    }
    const busy = [r.call("agt_bbb"), r.call("agt_ccc")];
    await new Promise((res) => setTimeout(res, 20));
    await assert.rejects(() => r.call("agt_ddd"), (e) => e instanceof AgentError && e.code === "unavailable" && /Waiting for room/.test(e.message));
    gate.forEach((g) => g());
    await Promise.all(busy);
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
