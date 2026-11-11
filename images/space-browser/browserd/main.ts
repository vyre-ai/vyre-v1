// browserd: the one program of the Space browser (owner decision 6 Nov). It answers the control protocol on a unix socket for `ctl` (modules/computers/sbrowser, `docker exec <container> /opt/browserd/ctl <action> '<json>'`),
// keeps one headless Chromium per profile (profiles.ts) and serves the live view and takeover input (view.ts). Every action names a profile by id.
//
//   status        {}                                                -> { profiles: [{ profileId, running, tabs, busy, takeover, viewers, lastActiveAt, held, paused }], maxRunning }
//   configure     { profileId, agentId?, spaceId?, tabLimit?, fillUrl?, fillToken? }   (the Vault channel is held in memory for that profile only)
//   tool          { profileId, tool, args, timeoutMs, by? }         -> the tool's answer (the chrome_* tools of agentd/chrome.ts)
//   takeover      { profileId, personId }                           give_back { profileId }
//   screenshot    { profileId }                                     -> { png, width, height }
//   stream        { profileId }                                     -> { transport: "mjpeg", url, ws }
//   downloads     { profileId } -> { downloads: [{ name, size, at }] }     download_read { profileId, name } -> { base64 }      download_ack { profileId, name }
//   stop          { profileId }  (the browser stops, the folder stays)      forget { profileId }  (the folder goes too)
//   sessions      { profileId }                                     -> { sessions: [{ site, since, lastSeen }] }      sign_out { profileId, site } -> { ok }
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import type { Cdp } from "../../agent-computer/agentd/cdp.ts";
import { AgentError, badInput, unavailable } from "../../agent-computer/agentd/errors.ts";
import { createRecentSites, startStartServer } from "./start.ts";
import type { StartServer } from "./start.ts";
import { createBridgeHub } from "./bridge.ts";
import type { BridgeHub } from "./bridge.ts";
import { createProfileManager, checkProfileId } from "./profiles.ts";
import { createCdpInput, createScreencastHub, startViewServer } from "./view.ts";
import type { Hub, ViewOf } from "./view.ts";

const env = process.env;
const ROOT = env["VYRE_BROWSER_ROOT"] ?? "/data";
const SOCKET = env["VYRE_BROWSERD_SOCKET"] ?? "/tmp/browserd.sock";
const PORT = Number(env["VYRE_STREAM_PORT"] ?? 7002);
const MAX_LINE = 12 * 1024 * 1024;
const log = (m: string): void => { process.stderr.write(`browserd: ${m}\n`); };

let bridges: BridgeHub | null = null;
let starts: StartServer | null = null;
const recentOf = (id: string) => createRecentSites(manager.get(id).dir);
const manager = createProfileManager({
  root: ROOT,
  extensionDir: existsSync("/opt/vyre-chrome") ? "/opt/vyre-chrome" : null,
  log,
  maxRunning: Number(env["VYRE_BROWSER_MAX_RUNNING"] ?? 6) || 6,
  idleMs: (Number(env["VYRE_BROWSER_IDLE_MINUTES"] ?? 10) || 10) * 60_000,
  tabLimit: Number(env["VYRE_TAB_LIMIT"] ?? 10) || 10,
  // Vyre for Chrome in a profile talks to the Space through browserd (bridge.ts); the bridge is up before the first browser starts
  extra: (id) => bridges?.prepare(id) ?? {},
  // the start page: the profile's browser carries a cookie that names it (set before the first tab goes to the page), and the pages it opens are remembered for the page's row of sites
  onStarted: async (id, chrome) => {
    if (!starts) return;
    const token = starts.token(id);
    const b = await chrome.browser();
    try {
      // a session cookie: it lives as long as this browser runs, and the token it carries is made new each time the browser starts, so the page names its agent however long the browser stays up
      await b.send("Storage.setCookies", { cookies: [{ name: "vyre_start", value: token, url: starts.url(), httpOnly: true, sameSite: "Lax" }] });
    } finally { b.close(); }
    // the first tab opens on the start page unless something already took it; when the browser brought back the tabs it had before it stopped, the blank one it was started with goes instead
    const tabs = await chrome.tabs();
    const first = tabs.find((t) => t.url === "about:blank" || t.url === "");
    if (!first) return;
    if (tabs.some((t) => t !== first && t.url !== "about:blank" && t.url !== "")) { const b2 = await chrome.browser(); try { await b2.send("Target.closeTarget", { targetId: first.id }); } finally { b2.close(); } return; }
    const c = await chrome.attach(first.id); try { await c.send("Page.navigate", { url: starts.url() }); } finally { c.close(); }
  },
  onPage: (id, url, title) => { try { recentOf(id).add(url, title); } catch { /* a note that cannot be kept is not an error */ } },
  onClosing: async (p) => { if (!p.chrome?.alive()) return; const c = await p.chrome.page(); try { manager.saveSessions(p.id, await liveSessions(c)); } finally { c.close(); } },
  paired: (id) => bridges?.state(id) ?? { connected: 0, hello: false, optin: false },
});

const address = (): string => {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return "127.0.0.1";
};

type Args = Record<string, unknown>;
const text = (a: Args, k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");
const audit: Array<{ profileId: string; at: number; event: Record<string, unknown> }> = [];

// ---- views -----------------------------------------------------------------------------------------------------------------------------------------

const hubs = new Map<string, Hub>();
const hubOf = (id: string): Hub => {
  let h = hubs.get(id);
  if (!h) {
    const p = manager.get(id);
    h = createScreencastHub({
      chrome: () => (p.chrome?.alive() ? p.chrome : null),
      wake: async () => { await manager.ensure(id); },
      activity: () => { p.viewers = hubs.get(id)?.viewers() ?? 0; manager.touch(id); },
      log,
    });
    hubs.set(id, h);
  }
  return h;
};

async function pageOf(id: string): Promise<Cdp> {
  const p = await manager.ensure(id);
  return p.chrome!.page();
}

const views = startViewServer({
  port: PORT,
  address,
  viewOf: (id): ViewOf | null => {
    const p = manager.get(id);
    return { hub: hubOf(id), input: createCdpInput(() => pageOf(id)), takenOver: () => p.state.takeover !== null, onInput: (event) => { audit.push({ profileId: id, at: Date.now(), event }); if (audit.length > 1000) audit.shift(); manager.touch(id); p.personActiveAt = Date.now(); } };
  },
});

// ---- the actions -----------------------------------------------------------------------------------------------------------------------------------

async function liveSessions(c: Cdp): Promise<Array<{ site: string; since: number; lastSeen: number }>> {
  const r = await c.send<{ cookies?: Array<{ domain: string; expires: number }> }>("Network.getAllCookies");
  const sites = new Set<string>();
  for (const k of r.cookies ?? []) sites.add(k.domain.replace(/^\./, ""));
  const now = Date.now();
  return [...sites].sort().map((site) => ({ site, since: now, lastSeen: now }));
}

/** A running browser is asked live (and the answer kept); a sleeping one is listed from what was kept when it closed, and nothing is started. */
async function sessions(id: string): Promise<Args> {
  const p = manager.get(id);
  if (!p.chrome?.alive()) return { sessions: manager.cachedSessions(id) };
  const c = await p.chrome.page();
  try { const rows = await liveSessions(c); manager.saveSessions(id, rows); return { sessions: rows }; } finally { c.close(); }
}

async function signOut(id: string, site: string): Promise<Args> {
  if (!/^[a-z0-9.-]{1,253}$/i.test(site)) throw badInput("Name the site as its host name, such as app.example.com.");
  const c = await pageOf(id);
  try {
    const r = await c.send<{ cookies?: Array<{ domain: string; name: string; path: string }> }>("Network.getAllCookies");
    for (const k of r.cookies ?? []) {
      const d = k.domain.replace(/^\./, "");
      if (d === site || d.endsWith(`.${site}`) || site.endsWith(`.${d}`)) await c.send("Network.deleteCookies", { name: k.name, domain: k.domain, path: k.path });
    }
    await c.send("Storage.clearDataForOrigin", { origin: `https://${site}`, storageTypes: "local_storage,session_storage,indexeddb,cache_storage" }).catch(() => undefined);
    return { ok: true };
  } finally { c.close(); }
}

async function dispatch(action: string, a: Args): Promise<Args> {
  switch (action) {
    // each row also says how many views the person at the controls has open and when they last sent input: what keeps a takeover in use (never the agent's calls, never someone else watching)
    case "status": return { profiles: (await manager.list()).map((r) => { const p = manager.get(r.profileId); return { ...r, holderViews: r.takeoverBy ? views.viewersOf(r.profileId, r.takeoverBy) : 0, ...(p.personActiveAt ? { personActiveAt: p.personActiveAt } : {}) }; }), maxRunning: Number(env["VYRE_BROWSER_MAX_RUNNING"] ?? 6) || 6, viewers: views.viewers() };
    case "configure": {
      const p = manager.get(checkProfileId(a["profileId"]));
      const n = a["tabLimit"];
      if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 200) p.state.tabLimit = n;
      if (typeof a["agentId"] === "string") p.agentId = a["agentId"];
      if (typeof a["spaceId"] === "string") p.spaceId = a["spaceId"];
      // The Vault channel for this profile only: held in memory, set again on every start. A profile fills only as its own agent.
      if (typeof a["fillUrl"] === "string" && typeof a["fillToken"] === "string") p.vault.setFiller(a["fillUrl"], a["fillToken"], p.id);
      return {};
    }
    case "tool": {
      // The Vault channel of this profile's agent rides the call that may type a handle, held in memory for this profile only.
      const pid = checkProfileId(a["profileId"]);
      if (typeof a["agentName"] === "string") manager.get(pid).agentName = a["agentName"].slice(0, 80);
      // the face is drawn once by the host and kept with the profile, so the start page fetches nothing
      if (typeof a["faceSvg"] === "string" && a["faceSvg"].startsWith("<svg") && a["faceSvg"].length < 60_000) { mkdirSync(manager.get(pid).dir, { recursive: true }); writeFileSync(`${manager.get(pid).dir}/face.svg`, a["faceSvg"]); }
      if (typeof a["spaceId"] === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(a["spaceId"])) manager.get(pid).spaceId = a["spaceId"];
      if (typeof a["fillUrl"] === "string" && typeof a["fillToken"] === "string") manager.get(pid).vault.setFiller(a["fillUrl"], a["fillToken"], pid);
      // Vyre for Chrome in the profile is paired with the Space as this agent as soon as the Space and the Vault channel are known
      if (manager.get(pid).spaceId && manager.get(pid).vault.hasChannel()) bridges?.pair(pid);
      // the hold as the Space's table has it now: browserd follows it, so a give back or an expiry it missed is repaired by the next call
      if ("hold" in a) manager.setHold(pid, typeof a["hold"] === "string" && a["hold"] !== "" ? a["hold"] : null);
      const args = (typeof a["args"] === "object" && a["args"] !== null ? a["args"] : {}) as Args;
      return manager.tool({ profileId: checkProfileId(a["profileId"]), tool: text(a, "tool"), args, timeoutMs: typeof a["timeoutMs"] === "number" ? a["timeoutMs"] : 30_000, ...(a["by"] === "person" ? { by: "person" } : {}) });
    }
    case "downloads": return { downloads: manager.downloads(checkProfileId(a["profileId"])) };
    case "download_read": return { base64: manager.downloadRead(checkProfileId(a["profileId"]), text(a, "name")).toString("base64") };
    case "download_ack": manager.downloadAck(checkProfileId(a["profileId"]), text(a, "name")); return {};
    case "download_keep": manager.downloadKeep(checkProfileId(a["profileId"]), text(a, "name")); return {};
    case "takeover": manager.takeover(checkProfileId(a["profileId"]), text(a, "personId")); return {};
    case "give_back": manager.giveBack(checkProfileId(a["profileId"])); return {};
    case "screenshot": {
      const c = await pageOf(checkProfileId(a["profileId"]));
      try {
        const shot = await c.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        const png = Buffer.from(shot.data, "base64");
        return { png: shot.data, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      } finally { c.close(); }
    }
    case "stream": {
      const id = checkProfileId(a["profileId"]);
      const p = await manager.ensure(id);
      const t = views.mint(id, typeof a["personId"] === "string" ? a["personId"] : undefined);
      // the size the viewer scales its pointer from: what the page's viewport really is, never a constant
      let size = { width: 1280, height: 800 };
      try { const c = await p.chrome!.page(); try { const r = await c.send<{ result?: { value?: { w: number; h: number } } }>("Runtime.evaluate", { expression: "({ w: innerWidth, h: innerHeight })", returnByValue: true }); if (r.result?.value) size = { width: r.result.value.w, height: r.result.value.h }; } finally { c.close(); } } catch { /* the configured size */ }
      return { transport: "mjpeg", url: views.url(t, "mjpeg"), ws: views.url(t, "ws"), ...size };
    }
    case "stop": hubs.delete(checkProfileId(a["profileId"])); await manager.stop(text(a, "profileId")); return {};
    case "reset_chrome": await manager.resetChrome(checkProfileId(a["profileId"])); hubs.delete(text(a, "profileId")); return {};
    case "import_done": manager.importDone(checkProfileId(a["profileId"])); return {};
    case "forget": hubs.delete(checkProfileId(a["profileId"])); await manager.forget(text(a, "profileId")); return {};
    case "sessions": return sessions(checkProfileId(a["profileId"]));
    case "sign_out": return signOut(checkProfileId(a["profileId"]), text(a, "site"));
    default: throw badInput(`browserd has no action ${action}.`);
  }
}

// ---- the control socket ----------------------------------------------------------------------------------------------------------------------------

function serve(c: Socket): void {
  let buf = "";
  c.setEncoding("utf8");
  c.on("error", () => undefined);
  c.on("data", (d: string) => {
    buf += d;
    if (buf.length > MAX_LINE) { c.destroy(); return; }
    const at = buf.indexOf("\n");
    if (at < 0) return;
    const line = buf.slice(0, at);
    buf = "";
    let req: { action?: unknown; args?: unknown };
    try { req = JSON.parse(line); } catch { c.end(JSON.stringify({ ok: false, code: "bad_input", message: "not JSON" }) + "\n"); return; }
    const args = (typeof req.args === "object" && req.args !== null ? req.args : {}) as Args;
    dispatch(String(req.action ?? ""), args).then(
      (result) => c.end(JSON.stringify({ ok: true, result }) + "\n"),
      (e: unknown) => {
        const err = e instanceof AgentError ? e : unavailable(e instanceof Error ? e.message : "the browser failed");
        c.end(JSON.stringify({ ok: false, code: err.code, message: err.message }) + "\n");
      },
    );
  });
}

async function main(): Promise<void> {
  rmSync(SOCKET, { force: true });
  mkdirSync(`${ROOT}/profiles`, { recursive: true });
  starts = await startStartServer({
    port: Number(env["VYRE_START_PORT"] ?? 7004) || 7004,
    data: (id) => { const p = manager.get(id); let faceSvg: string | undefined; try { faceSvg = readFileSync(`${p.dir}/face.svg`, "utf8"); } catch { /* the initial */ } return { name: p.agentName ?? "Vyre", face: "", ...(faceSvg ? { faceSvg } : {}), recent: recentOf(id).list() }; },
  });
  bridges = await createBridgeHub({ root: ROOT, port: Number(env["VYRE_BRIDGE_PORT"] ?? 0) || 0, profile: (id) => manager.get(id), log });
  const control = createNetServer(serve);
  await new Promise<void>((resolve, reject) => { control.once("error", reject); control.listen(SOCKET, () => resolve()); });
  chmodSync(SOCKET, 0o600);
  log(`control socket ${SOCKET}, live view on ${PORT}`);
  const sweeper = setInterval(() => { manager.sweep().then((s) => { for (const id of s) { hubs.delete(id); log(`profile ${id} stopped after idle`); } }, () => undefined); }, (Number(env["VYRE_BROWSER_SWEEP_SECONDS"] ?? 30) || 30) * 1000);
  sweeper.unref();
  const bye = (): void => {
    clearInterval(sweeper);
    views.close();
    bridges?.close();
    starts?.close();
    control.close();
    // every browser is closed properly (cookies and logins reach the volume) before the process ends; Docker waits 10 s
    void manager.stopAll().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

main().catch((e: unknown) => { log(`fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
