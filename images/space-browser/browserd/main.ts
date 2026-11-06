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
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { connectCdp } from "../../agent-computer/agentd/cdp.ts";
import type { Cdp } from "../../agent-computer/agentd/cdp.ts";
import { AgentError, badInput, unavailable } from "../../agent-computer/agentd/errors.ts";
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
const manager = createProfileManager({
  root: ROOT,
  extensionDir: existsSync("/opt/vyre-chrome") ? "/opt/vyre-chrome" : null,
  log,
  maxRunning: Number(env["VYRE_BROWSER_MAX_RUNNING"] ?? 6) || 6,
  idleMs: (Number(env["VYRE_BROWSER_IDLE_MINUTES"] ?? 10) || 10) * 60_000,
  tabLimit: Number(env["VYRE_TAB_LIMIT"] ?? 10) || 10,
  // Vyre for Chrome in a profile talks to the Space through browserd (bridge.ts); the bridge is up before the first browser starts
  extra: (id) => bridges?.prepare(id) ?? {},
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
      port: () => (p.chrome?.alive() ? p.port : null),
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
    return { hub: hubOf(id), input: createCdpInput(() => pageOf(id)), takenOver: () => p.state.takeover !== null, onInput: (event) => { audit.push({ profileId: id, at: Date.now(), event }); if (audit.length > 1000) audit.shift(); manager.touch(id); } };
  },
});

// ---- the actions -----------------------------------------------------------------------------------------------------------------------------------

async function sessions(id: string): Promise<Args> {
  const c = await pageOf(id);
  try {
    const r = await c.send<{ cookies?: Array<{ domain: string; expires: number }> }>("Network.getAllCookies");
    const sites = new Set<string>();
    for (const k of r.cookies ?? []) sites.add(k.domain.replace(/^\./, ""));
    const now = Date.now();
    return { sessions: [...sites].sort().map((site) => ({ site, since: now, lastSeen: now })) };
  } finally { c.close(); }
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
    case "status": return { profiles: await manager.list(), maxRunning: Number(env["VYRE_BROWSER_MAX_RUNNING"] ?? 6) || 6, viewers: views.viewers() };
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
      if (typeof a["spaceId"] === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(a["spaceId"])) manager.get(pid).spaceId = a["spaceId"];
      if (typeof a["fillUrl"] === "string" && typeof a["fillToken"] === "string") manager.get(pid).vault.setFiller(a["fillUrl"], a["fillToken"], pid);
      // Vyre for Chrome in the profile is paired with the Space as this agent as soon as the Space and the Vault channel are known
      if (manager.get(pid).spaceId && manager.get(pid).vault.hasChannel()) bridges?.pair(pid);
      const args = (typeof a["args"] === "object" && a["args"] !== null ? a["args"] : {}) as Args;
      return manager.tool({ profileId: checkProfileId(a["profileId"]), tool: text(a, "tool"), args, timeoutMs: typeof a["timeoutMs"] === "number" ? a["timeoutMs"] : 30_000, ...(a["by"] === "person" ? { by: "person" } : {}) });
    }
    case "downloads": return { downloads: manager.downloads(checkProfileId(a["profileId"])) };
    case "download_read": return { base64: manager.downloadRead(checkProfileId(a["profileId"]), text(a, "name")).toString("base64") };
    case "download_ack": manager.downloadAck(checkProfileId(a["profileId"]), text(a, "name")); return {};
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
      await manager.ensure(id);
      const t = views.mint(id);
      return { transport: "mjpeg", url: views.url(t, "mjpeg"), ws: views.url(t, "ws") };
    }
    case "stop": hubs.delete(checkProfileId(a["profileId"])); await manager.stop(text(a, "profileId")); return {};
    case "reset_chrome": hubs.delete(checkProfileId(a["profileId"])); await manager.resetChrome(text(a, "profileId")); return {};
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
    control.close();
    // every browser is closed properly (cookies and logins reach the volume) before the process ends; Docker waits 10 s
    void manager.stopAll().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

main().catch((e: unknown) => { log(`fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
