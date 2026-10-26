// agentd (spec 2.7, ARCH 6.6, 6.11): the one program that runs an agent computer. It starts the screen (Xvfb) and the browser (Chromium), answers the control protocol on a unix socket for
// `ctl` (modules/computers/impl.ts, CONTROL PROTOCOL, and the `tool` action of handlers/tools/common.ts), and serves the live view and the person's input (stream.ts).
//
//   status        { tabs, busy, caption?, lastFrameAt?, diskBytes? }       configure   { tabLimit }
//   takeover      { personId }                                              give_back   {}
//   screenshot    { png, width, height }                                    stream      { ticket } -> { transport: "mjpeg", url, ws }
//   record_start  { recordingId }                                           record_stop { recordingId } -> { events, har, durationMs }
//   sessions      { sessions: [{ site, since, lastSeen }] }                 sign_out    { site } -> { ok }
//   tool          { tool, args, timeoutMs } -> the tool's answer
//
// Not done in this build, said so rather than faked: WebRTC for the live view (only if MJPEG misses S9). #Handle.field is filled from the host over its channel (vault.ts, set by configure fillUrl and fillToken); nothing is written to disk. Vyre for Chrome is loaded from /opt/vyre-chrome when the image was built with the `ext` context.
// Every process of the computer (the browser, the Terminal) makes files and folders anyone may change: the home folder is shared with the daemon, which mirrors it into Files as another user.
process.umask(0o000);
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { AgentError, badInput, notFound, paused, unavailable, within } from "./errors.ts";
import { launchChrome } from "./chrome.ts";
import type { ChromeState } from "./chrome.ts";
import { fileTools } from "./files.ts";
import { fillArgs, scrubUsed, setFiller } from "./vault.ts";
import { createFrameHub } from "./frames.ts";
import { createRecorder } from "./record.ts";
import { screenTools } from "./screen.ts";
import { startStreamServer } from "./stream.ts";
import { startDesktop } from "./desktop.ts";
import { createInjector, parseSize, screenshotPng, startXvfb } from "./x11.ts";
import type { Screen } from "./x11.ts";

const env = process.env;
const size = env["VYRE_SCREEN"] ?? "1280x800";
const screen: Screen = { display: env["DISPLAY"] ?? ":99", size, ...parseSize(size) };
const SOCKET = env["VYRE_AGENTD_SOCKET"] ?? "/tmp/agentd.sock";
const HOME = env["HOME"] ?? "/home/agent";
const PROFILE = env["VYRE_PROFILE_DIR"] ?? `${HOME}/.profile-disk`;
const FILES = env["VYRE_FILES_DIR"] ?? `${HOME}/Vyre`;
const FPS = Number(env["VYRE_STREAM_FPS"] ?? 10);
const PORT = Number(env["VYRE_STREAM_PORT"] ?? 7001);
const MAX_LINE = 12 * 1024 * 1024;

const log = (m: string): void => { process.stderr.write(`agentd: ${m}\n`); };

const state: ChromeState & { takeover: { personId: string; since: number } | null; busy: number; caption: string | undefined } = {
  stopped: false, tabLimit: Number(env["VYRE_TAB_LIMIT"] ?? 10) || 10, takeover: null, busy: 0, caption: undefined,
};

const address = (): string => {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return "127.0.0.1";
};

mkdirSync(PROFILE, { recursive: true });
mkdirSync(`${PROFILE}/chrome`, { recursive: true });

const recorder = createRecorder(screen, FILES, 5);
const injector = createInjector(screen, log);
const hub = createFrameHub({ display: screen.display, size: screen.size, fps: FPS, log });
const screenApi = screenTools(screen, injector, (e) => recorder.note({ by: "agent", ...e }));
const filesApi = fileTools(FILES);
const chrome = launchChrome(screen, `${PROFILE}/chrome`, existsSync("/opt/vyre-chrome") ? "/opt/vyre-chrome" : null, log);
const stream = startStreamServer({ port: PORT, hub, input: injector, takenOver: () => state.takeover !== null, address, onInput: (e) => recorder.note(e) });

// ---- the actions ------------------------------------------------------------------------------------------------------------------------------------

function du(dir: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("du", ["-sb", dir], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout!.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    p.on("close", () => resolve(Number(out.split(/\s+/)[0]) || 0));
    p.on("error", () => resolve(0));
  });
}

type Args = Record<string, unknown>;
const text = (a: Args, k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");

async function sessions(): Promise<Args> {
  const c = await chrome.page();
  try {
    const r = await c.send<{ cookies?: Array<{ domain: string; name: string; expires: number }> }>("Network.getAllCookies");
    const bySite = new Map<string, number>();
    for (const k of r.cookies ?? []) bySite.set(k.domain.replace(/^\./, ""), Math.max(bySite.get(k.domain.replace(/^\./, "")) ?? 0, k.expires > 0 ? k.expires * 1000 : 0));
    const now = Date.now();
    return { sessions: [...bySite.keys()].sort().map((site) => ({ site, since: now, lastSeen: now })) };
  } finally { c.close(); }
}

async function signOut(site: string): Promise<Args> {
  if (!/^[a-z0-9.-]{1,253}$/i.test(site)) throw badInput("Name the site as its host name, such as app.example.com.");
  const c = await chrome.page();
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

async function runTool(args: Args): Promise<Args> {
  const name = text(args, "tool");
  const a = (typeof args["args"] === "object" && args["args"] !== null ? args["args"] : {}) as Args;
  const ms = typeof args["timeoutMs"] === "number" ? Math.min(args["timeoutMs"], 130_000) : 30_000;
  const isChrome = name.startsWith("chrome_");
  const isScreen = name.startsWith("screen_");
  const isFiles = name.startsWith("computer_files_");
  if (!isChrome && !isScreen && !isFiles) throw badInput(`${name} is not a tool of this computer.`);
  // A person at the controls: the agent's tools wait, except the two that only look.
  if (state.takeover && name !== "chrome_status" && name !== "chrome_stop") throw paused("A person has the controls. The tools wait until they give them back.");
  // Only the tools that type or fill take #Handle.field: a CSS selector such as #main.content in a script is not one.
  const typing = name === "screen_type" || name === "chrome_type" || name === "chrome_fill" || name === "chrome_act";
  const filled = typing ? await fillArgs(a) : { args: a, used: [] };
  state.busy += 1;
  try {
    const raw = await within(ms, name, async () => {
      if (isChrome) return chrome.tool(name, filled.args, state);
      if (isScreen) return screenApi.run(name, filled.args);
      return filesApi.run(name, filled.args);
    });
    const out = filled.used.length > 0 ? { ...scrubUsed(raw, filled.used), used: filled.used } : raw;
    state.caption = name.replace(/_/g, " ");
    recorder.note({ by: "agent", type: "tool", tool: name });
    // The picture after the step is the timeline's frame. A look at the screen is its own picture.
    if (name !== "screen_screenshot" && name !== "chrome_screenshot" && !isFiles && name !== "chrome_status" && name !== "screen_wait") {
      try { return { ...out, frame: (await screenshotPng(screen)).toString("base64") }; } catch { return out; }
    }
    return out;
  } finally { state.busy -= 1; }
}

async function dispatch(action: string, a: Args): Promise<Args> {
  switch (action) {
    case "status": {
      const tabs = await chrome.tabs();
      const last = hub.lastFrameAt();
      return { tabs: tabs.length, busy: state.busy > 0, ...(state.caption ? { caption: state.caption } : {}), ...(last ? { lastFrameAt: last } : {}), diskBytes: await du(PROFILE), extension: await chrome.extension() };
    }
    case "configure": {
      const n = a["tabLimit"];
      if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 200) state.tabLimit = n;
      // The host's channel for Vault fill: held in memory only, set again on every start.
      if (typeof a["fillUrl"] === "string" && typeof a["fillToken"] === "string") setFiller(a["fillUrl"], a["fillToken"], env["VYRE_COMPUTER_ID"] ?? "");
      return {};
    }
    case "takeover": {
      const personId = text(a, "personId");
      if (!personId) throw badInput("Say which person takes over.");
      state.takeover = { personId, since: Date.now() };
      recorder.note({ by: "person", type: "takeover" });
      return {};
    }
    case "give_back":
      state.takeover = null;
      recorder.note({ by: "person", type: "give_back" });
      return {};
    case "screenshot": {
      const png = await screenshotPng(screen);
      return { png: png.toString("base64"), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    }
    case "stream": {
      const t = stream.mint();
      return { transport: "mjpeg", url: stream.url(t, "mjpeg"), ws: stream.url(t, "ws") };
    }
    case "record_start":
      recorder.start(text(a, "recordingId"));
      return {};
    case "record_stop": {
      const r = await recorder.stop(text(a, "recordingId"));
      return { events: r.events, har: r.har, durationMs: r.durationMs, bytes: r.bytes };
    }
    case "sessions": return sessions();
    case "sign_out": return signOut(text(a, "site"));
    case "tool": return runTool(a);
    default:
      throw badInput(`agentd has no action ${action}.`);
  }
}

// ---- the control socket -----------------------------------------------------------------------------------------------------------------------------

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
        const err = e instanceof AgentError ? e : unavailable(e instanceof Error ? e.message : "the computer failed");
        c.end(JSON.stringify({ ok: false, code: err.code, message: err.message }) + "\n");
      },
    );
  });
}

async function main(): Promise<void> {
  rmSync(SOCKET, { force: true });
  // The control socket comes up first: the host asks `configure` until agentd answers, long before the browser is ready.
  const control = createNetServer(serve);
  await new Promise<void>((resolve, reject) => { control.once("error", reject); control.listen(SOCKET, () => resolve()); });
  chmodSync(SOCKET, 0o600);
  log(`control socket ${SOCKET}`);
  const xvfb = await startXvfb(screen, log);
  log(`screen ${screen.display} ${screen.size}`);
  const desktop = startDesktop(screen, HOME, `${PROFILE}/chrome`, log);
  // The input helper takes a moment to start; the first input a person sends should not pay for it.
  injector.call({ op: "pointer" }).catch(() => undefined);
  chrome.ready().then(() => log("browser ready"), (e: unknown) => log(`browser failed: ${e instanceof Error ? e.message : "unknown"}`));
  const bye = (): void => {
    stream.close();
    injector.stop();
    chrome.stop();
    desktop.stop();
    xvfb.kill("SIGTERM");
    control.close();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

main().catch((e: unknown) => { log(`fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
