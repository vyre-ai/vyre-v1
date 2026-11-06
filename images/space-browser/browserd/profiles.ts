// The profiles of the Space browser (owner decision 6 Nov: one Chrome service per Space, a profile per agent and per person's Assistant). A profile is its own user-data-dir on the data volume, so its
// cookies, logins, local storage and tabs never meet another profile's. Its Chromium starts when the profile first browses and stops after idle minutes; the folder stays. One headless Chromium per
// running profile, each on its own DevTools port on 127.0.0.1, driven by the same tools as an agent computer's browser (agentd/chrome.ts).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectCdp } from "../../agent-computer/agentd/cdp.ts";
import { launchChrome } from "../../agent-computer/agentd/chrome.ts";
import type { Chrome, ChromeOptions, ChromeState } from "../../agent-computer/agentd/chrome.ts";
import { badInput, notFound, paused, unavailable, within } from "../../agent-computer/agentd/errors.ts";
import { createVault, scrubUsed } from "../../agent-computer/agentd/vault.ts";
import type { Vault } from "../../agent-computer/agentd/vault.ts";

/** A profile id is an agent id (agt_...) or another short name made of letters, digits, `_` and `-`. It becomes a folder name, so nothing else is allowed in it. */
export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
export const checkProfileId = (id: unknown): string => {
  if (typeof id !== "string" || !PROFILE_ID.test(id)) throw badInput("Name the profile with its id: letters, digits, _ and -, at least 3 characters.");
  return id;
};

/** A download in a profile's downloads folder that Chrome has finished (not a `.crdownload` or a hidden file). */
export interface DownloadRow { name: string; size: number; at: number }
const MAX_DOWNLOAD = 20 * 1024 * 1024;
const SAFE_NAME = /^[^/\\\x00-\x1f.][^/\\\x00-\x1f]{0,254}$/;

/** Make Chrome save into this folder and never ask: the preferences file is written before the browser starts (an existing one keeps everything else it holds). */
export function writeDownloadPrefs(chromeDir: string, downloadsDir: string): void {
  const dir = join(chromeDir, "Default");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "Preferences");
  let prefs: Record<string, unknown> = {};
  try { prefs = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* a new profile */ }
  const dl = (typeof prefs["download"] === "object" && prefs["download"] !== null ? prefs["download"] : {}) as Record<string, unknown>;
  const sf = (typeof prefs["savefile"] === "object" && prefs["savefile"] !== null ? prefs["savefile"] : {}) as Record<string, unknown>;
  prefs["download"] = { ...dl, default_directory: downloadsDir, prompt_for_download: false, directory_upgrade: true };
  prefs["savefile"] = { ...sf, default_directory: downloadsDir };
  writeFileSync(file, JSON.stringify(prefs));
}

export type LaunchFn = (profileDir: string, extensionDir: string | null, log: (m: string) => void, o: ChromeOptions) => Chrome;
const realLaunch: LaunchFn = (dir, ext, log, o) => launchChrome(null, dir, ext, log, { headless: true, ...o });

export interface ProfileManagerOptions {
  /** The data volume: profiles live in `<root>/profiles/<id>/chrome`. */
  root: string;
  extensionDir: string | null;
  log: (m: string) => void;
  /** At most this many Chromium processes at once. Default 6. */
  maxRunning?: number;
  /** A running profile with nobody watching and no work for this long is stopped. Default 10 minutes. */
  idleMs?: number;
  tabLimit?: number;
  /** The first DevTools port; each running profile takes the next free one. Default 9300. */
  basePort?: number;
  now?: () => number;
  launch?: LaunchFn;
  /** Extra browser flags and environment for one profile, such as its bridge folder (bridge.ts). Called each time the profile's browser starts. */
  extra?: (profileId: string) => ChromeOptions;
  /** Called when a profile's browser is up: the start page's cookie and first tab (main.ts). */
  onStarted?: (profileId: string, port: number) => Promise<void>;
  /** A page the profile's browser opened or looked at, for its start page's recent sites. */
  onPage?: (profileId: string, url: string, title: string) => void;
  /** What the profile's Vyre for Chrome is doing with the Space, for the profile's row. */
  paired?: (profileId: string) => { connected: number; hello: boolean; optin: boolean };
}

export interface Profile {
  readonly id: string;
  readonly dir: string;
  readonly vault: Vault;
  readonly state: ChromeState & { takeover: { personId: string; since: number } | null; busy: number; caption: string | undefined };
  chrome: Chrome | null;
  port: number | null;
  lastActiveAt: number;
  /** People watching its live view (view.ts counts them). */
  viewers: number;
  /** The agent this profile belongs to, as the Space said when it configured it. */
  agentId: string | undefined;
  /** The agent's name, for its start page. */
  agentName: string | undefined;
  spaceId: string | undefined;
  starting: Promise<void> | null;
}

export interface ProfileRow { profileId: string; running: boolean; tabs: number; busy: boolean; takeover: boolean; viewers: number; lastActiveAt: number; port?: number; held: number; paused: boolean; takeoverBy?: string; bridge?: { connected: number; hello: boolean; optin: boolean } }

export interface ProfileManager {
  /** The profile's record (made on first mention; no browser starts). */
  get(id: string): Profile;
  /** Start the profile's browser if it is not running, making room first. */
  ensure(id: string): Promise<Profile>;
  /** One browser tool for one profile. `by: "person"` is the person at the controls, through the live view. */
  tool(a: { profileId: string; tool: string; args: Record<string, unknown>; timeoutMs: number; by?: string }): Promise<Record<string, unknown>>;
  takeover(id: string, personId: string): void;
  giveBack(id: string): void;
  /** Stop the browser, keep the folder. */
  stop(id: string): Promise<void>;
  /** Stop the browser and empty the profile's Chrome folder, ready for Chrome's data from an old computer to be put there (migration). */
  resetChrome(id: string): Promise<void>;
  /** Stop the browser and delete the folder (the agent was removed). */
  forget(id: string): Promise<void>;
  /** One pass of the idle check; returns the profiles it stopped. Called on a timer by main.ts, and by tests. */
  sweep(): Promise<string[]>;
  list(): Promise<ProfileRow[]>;
  /** Close every browser (the container is stopping). */
  stopAll(): Promise<void>;
  /** For a viewer that is attached or gone: counts as activity. */
  touch(id: string): void;
  /** What the profile's browser finished downloading and nobody has taken yet. Needs no browser. */
  downloads(id: string): DownloadRow[];
  /** One finished download's bytes (up to 20 MB). */
  downloadRead(id: string, name: string): Buffer;
  /** The download is in the agent's Files: it leaves this folder. */
  downloadAck(id: string, name: string): void;
}

export function createProfileManager(o: ProfileManagerOptions): ProfileManager {
  const now = o.now ?? Date.now;
  const launch = o.launch ?? realLaunch;
  const maxRunning = o.maxRunning ?? 6;
  const idleMs = o.idleMs ?? 10 * 60_000;
  const basePort = o.basePort ?? 9300;
  const profiles = new Map<string, Profile>();
  const ports = new Set<number>();

  const take = (): number => { for (let p = basePort; p < basePort + 200; p++) if (!ports.has(p)) { ports.add(p); return p; } throw unavailable("The Space browser has no free port."); };

  function get(idIn: string): Profile {
    const id = checkProfileId(idIn);
    let p = profiles.get(id);
    if (!p) {
      const dir = join(o.root, "profiles", id);
      p = {
        id, dir, vault: createVault(),
        state: { stopped: false, tabLimit: o.tabLimit ?? 10, takeover: null, busy: 0, caption: undefined },
        chrome: null, port: null, lastActiveAt: now(), viewers: 0, agentId: undefined, agentName: undefined, spaceId: undefined, starting: null,
      };
      profiles.set(id, p);
    }
    return p;
  }

  const downloadsOf = (p: Profile): string => join(p.dir, "downloads");
  const safeName = (name: string): string => { if (!SAFE_NAME.test(name) || name.endsWith(".crdownload")) throw badInput("That is not a download's name."); return name; };

  const running = (): Profile[] => [...profiles.values()].filter((p) => p.chrome !== null);
  const quiet = (p: Profile): boolean => p.state.busy === 0 && p.viewers === 0 && p.state.takeover === null;

  async function release(p: Profile): Promise<void> {
    const c = p.chrome;
    if (!c) return;
    p.chrome = null;
    // closed the way a person closes it, so a login that was just made is in the folder when the browser starts again
    await c.shutdown().catch(() => c.stop());
    if (p.port !== null) { const port = p.port; p.port = null; setTimeout(() => ports.delete(port), 1500).unref(); }
  }

  async function makeRoom(except: string): Promise<void> {
    if (running().length < maxRunning) return;
    const idle = running().filter((p) => p.id !== except && quiet(p)).sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
    if (!idle) throw unavailable("Waiting for room on the Space browser: every browser it can hold is busy. Add a compute server, or try again in a minute.");
    o.log(`profile ${idle.id} stopped to make room`);
    await release(idle);
  }

  async function ensure(id: string): Promise<Profile> {
    const p = get(id);
    p.lastActiveAt = now();
    if (p.chrome?.alive()) return p;
    if (p.starting) { await p.starting; return p; }
    p.starting = (async () => {
      await makeRoom(p.id);
      if (p.chrome) await release(p);
      mkdirSync(join(p.dir, "chrome"), { recursive: true });
      mkdirSync(downloadsOf(p), { recursive: true });
      writeDownloadPrefs(join(p.dir, "chrome"), downloadsOf(p));
      const port = take();
      p.port = port;
      const opts = { port, ...(o.extra?.(p.id) ?? {}) };
      const c = launch(join(p.dir, "chrome"), o.extensionDir, o.log, opts);
      p.chrome = c;
      try { await c.ready(); } catch (e) { await release(p); throw e; }
      // and the browser itself is told, so a download from a tab opened later goes the same way
      try {
        const v = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl?: string };
        if (v.webSocketDebuggerUrl) { const b = await connectCdp(v.webSocketDebuggerUrl, 3000); await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsOf(p) }).catch(() => undefined); b.close(); }
      } catch { /* the preferences already say it; a fake browser in a test has no DevTools */ }
      await o.onStarted?.(p.id, port).catch((e: unknown) => o.log(`start page: ${e instanceof Error ? e.message : "failed"}`));
    })();
    try { await p.starting; } finally { p.starting = null; }
    return p;
  }

  async function tool(a: { profileId: string; tool: string; args: Record<string, unknown>; timeoutMs: number; by?: string }): Promise<Record<string, unknown>> {
    const p = get(a.profileId);
    const name = a.tool;
    if (!name.startsWith("chrome_")) throw badInput(`${name} is not a tool of the Space browser.`);
    const byPerson = a.by === "person" && p.state.takeover !== null;
    // A person at the controls: the agent's tools wait, except the two that only look.
    if (p.state.takeover && !byPerson && name !== "chrome_status" && name !== "chrome_stop") throw paused("A person has the controls. The tools wait until they give them back.");
    const ms = Math.min(Math.max(a.timeoutMs, 1000), 130_000);
    // A look that needs no browser does not start one.
    if (name === "chrome_status" && !p.chrome?.alive()) return { connected: false, paused: p.state.stopped, held: [] };
    if ((name === "chrome_stop" || name === "chrome_resume" || name === "chrome_plan") && !p.chrome?.alive()) {
      if (name === "chrome_stop") { p.state.stopped = true; return { stopped: true }; }
      if (name === "chrome_resume") { const was = p.state.stopped; p.state.stopped = false; return { resumed: was }; }
      return { ok: true };
    }
    const typing = name === "chrome_type" || name === "chrome_fill" || name === "chrome_act";
    // Handles are asked of the Vault before the browser starts: a refusal must not cost a Chromium.
    const filled = typing ? await p.vault.fillArgs(a.args) : { args: a.args, used: [] };
    p.state.busy += 1;
    p.lastActiveAt = now();
    try {
      const prof = await ensure(p.id);
      const c = prof.chrome as Chrome;
      const raw = await within(ms, name, () => c.tool(name, filled.args, prof.state));
      const out = filled.used.length > 0 ? { ...scrubUsed(raw, filled.used), used: filled.used } : raw;
      p.state.caption = name.replace(/_/g, " ");
      if ((name === "chrome_open" || name === "chrome_state") && typeof out["url"] === "string") o.onPage?.(p.id, out["url"], typeof out["title"] === "string" ? out["title"] : "");
      return out;
    } finally { p.state.busy -= 1; p.lastActiveAt = now(); }
  }

  return {
    get, ensure, tool,
    takeover(id, personId) {
      if (!personId) throw badInput("Say which person takes over.");
      const p = get(id);
      if (p.state.takeover && p.state.takeover.personId !== personId) throw badInput("Someone else has the controls.");
      p.state.takeover = { personId, since: now() };
      p.lastActiveAt = now();
    },
    giveBack(id) { const p = get(id); p.state.takeover = null; p.lastActiveAt = now(); },
    async stop(id) { const p = profiles.get(checkProfileId(id)); if (p) { p.state.takeover = null; await release(p); } },
    async resetChrome(id) {
      const p = get(id);
      p.state.takeover = null;
      await release(p);
      rmSync(join(p.dir, "chrome"), { recursive: true, force: true });
      mkdirSync(p.dir, { recursive: true });
    },
    async forget(id) {
      const p = profiles.get(checkProfileId(id));
      if (p) { await release(p); profiles.delete(p.id); rmSync(p.dir, { recursive: true, force: true }); }
      else rmSync(join(o.root, "profiles", checkProfileId(id)), { recursive: true, force: true });
    },
    async sweep() {
      const stopped: string[] = [];
      for (const p of running()) {
        if (!quiet(p)) continue;
        const held = p.chrome?.heldIds().length ?? 0;
        const waited = now() - p.lastActiveAt;
        // a held send waits for its person for up to twenty minutes; a browser that holds one stays up that long
        if (waited < idleMs || (held > 0 && waited < 20 * 60_000)) continue;
        await release(p);
        stopped.push(p.id);
      }
      return stopped;
    },
    async list() {
      const rows: ProfileRow[] = [];
      for (const p of profiles.values()) {
        const alive = p.chrome?.alive() === true;
        const tabs = alive && p.chrome ? (await p.chrome.tabs()).length : 0;
        rows.push({ profileId: p.id, running: alive, tabs, busy: p.state.busy > 0, takeover: p.state.takeover !== null, viewers: p.viewers, lastActiveAt: p.lastActiveAt, ...(p.port !== null ? { port: p.port } : {}), held: p.chrome?.heldIds().length ?? 0, paused: p.state.stopped, ...(p.state.takeover ? { takeoverBy: p.state.takeover.personId } : {}), ...(o.paired ? { bridge: o.paired(p.id) } : {}) });
      }
      return rows;
    },
    async stopAll() { await Promise.all([...profiles.values()].map((p) => release(p))); },
    downloads(id) {
      const dir = downloadsOf(get(id));
      if (!existsSync(dir)) return [];
      const rows: DownloadRow[] = [];
      for (const name of readdirSync(dir)) {
        if (!SAFE_NAME.test(name) || name.endsWith(".crdownload") || name.endsWith(".tmp")) continue;
        const st = statSync(join(dir, name));
        // a file Chrome wrote a moment ago may still be growing: it is taken once it has been quiet for a second
        if (st.isFile() && now() - st.mtimeMs > 1000) rows.push({ name, size: st.size, at: Math.round(st.mtimeMs) });
      }
      return rows.sort((a, b) => a.at - b.at);
    },
    downloadRead(id, name) {
      const f = join(downloadsOf(get(id)), safeName(name));
      if (!existsSync(f)) throw notFound(`There is no download ${name}.`);
      if (statSync(f).size > MAX_DOWNLOAD) throw badInput("That download is over 20 MB: too large to move into Files here.");
      return readFileSync(f);
    },
    downloadAck(id, name) { rmSync(join(downloadsOf(get(id)), safeName(name)), { force: true }); },
    touch(id) { const p = profiles.get(id); if (p) p.lastActiveAt = now(); },
  };
}

