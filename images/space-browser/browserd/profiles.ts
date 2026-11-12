// The profiles of the Space browser (owner decision 6 Nov: one Chrome service per Space, a profile per agent and per person's Assistant). A profile is its own user-data-dir on the data volume, so its
// cookies, logins, local storage and tabs never meet another profile's. Its Chromium starts when the profile first browses and stops after idle minutes; the folder stays. One headless Chromium per
// running profile, driven by the same tools as an agent computer's browser (agentd/chrome.ts) over its DevTools pipe: no profile's browser opens a DevTools port, so a page in one agent's browser has
// nothing on 127.0.0.1 to open another agent's browser with (all profiles share the container's loopback).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, totalmem } from "node:os";
import { launchChrome } from "../../agent-computer/agentd/chrome.ts";
import type { Chrome, ChromeOptions, ChromeState } from "../../agent-computer/agentd/chrome.ts";
import { AgentError, badInput, notFound, paused, unavailable, within } from "../../agent-computer/agentd/errors.ts";
import { createVault, scrubUsed } from "../../agent-computer/agentd/vault.ts";
import type { CallChannel, Vault } from "../../agent-computer/agentd/vault.ts";

/** The line an act on stale refs is refused with (the module gives the same line). */
export const REOPENED_LINE = "Your browser was reopened and its pages reloaded. Take a new snapshot before you click.";
const SPACE_FILE = "space";
const BOOT = Math.random().toString(36).slice(2, 10);
let starts = 0;
/** The Space a profile's folder says it belongs to, or undefined. */
function spaceOnDisk(dir: string): string | undefined {
  try { const s = readFileSync(join(dir, SPACE_FILE), "utf8").trim(); return /^[A-Za-z0-9_-]{3,80}$/.test(s) ? s : undefined; } catch { return undefined; }
}

/** A profile id is an agent id (agt_...) or another short name made of letters, digits, `_` and `-`. It becomes a folder name, so nothing else is allowed in it. */
export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
export const checkProfileId = (id: unknown): string => {
  if (typeof id !== "string" || !PROFILE_ID.test(id)) throw badInput("Name the profile with its id: letters, digits, _ and -, at least 3 characters.");
  return id;
};

/** A download in a profile's downloads folder that Chrome has finished (not a `.crdownload` or a hidden file). */
export interface DownloadRow { name: string; size: number; at: number }
export const MAX_DOWNLOAD = 20 * 1024 * 1024;
/** The steps that can set off a download: when the browser said a download began during the step, the step waits for it to finish (up to SETTLE_MS), so the step that downloaded is the one that reports it.
 * A step that set off no download waits for nothing: no timer runs on every click. */
const ACTING: ReadonlySet<string> = new Set(["chrome_click", "chrome_act", "chrome_open", "chrome_send", "chrome_type"]);
const SETTLE_MS = 15_000;
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

// How many browsers may run at once (owner, 12 Nov: "it needs to work on more than 30 ... smoothly"): as many as this container's memory holds, BROWSER_MB each on top of BASE_MB for browserd itself
// (the same 256 MB a browser holds back in the Space's book, modules/computers/capacity.ts). VYRE_BROWSER_MAX_RUNNING, when an admin sets it, is an upper bound only. A container with no memory limit
// that can be read counts the computer's own memory.
const BROWSER_MB = 256;
const BASE_MB = 512;
export function memoryLimitMb(read: (f: string) => string = (f) => readFileSync(f, "utf8"), total: () => number = () => Math.round(totalmem() / 1048576)): number {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try { const v = read(f).trim(); if (/^\d+$/.test(v)) { const mb = Math.round(Number(v) / 1048576); if (mb > 0 && mb < 4_194_304) return Math.min(mb, total()); } } catch { /* not this cgroup version */ }
  }
  return total();
}
/** The cores this container may use (cgroup v2 cpu.max quota over period, or v1 cfs), else the computer's. */
export function cpuLimit(read: (f: string) => string = (f) => readFileSync(f, "utf8"), total: () => number = () => cpus().length): number {
  try { const [q, per] = read("/sys/fs/cgroup/cpu.max").trim().split(/\s+/); if (q && q !== "max" && Number(per) > 0) return Math.max(1, Math.round(Number(q) / Number(per))); } catch { /* v1 or none */ }
  try { const q = Number(read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").trim()); const per = Number(read("/sys/fs/cgroup/cpu/cpu.cfs_period_us").trim()); if (q > 0 && per > 0) return Math.max(1, Math.round(q / per)); } catch { /* none */ }
  return Math.max(1, total());
}
/** The container's process and thread cap (cgroup pids.max), or null when there is none. A headless Chromium counts about PIDS_PER_BROWSER tasks (its processes and their threads). */
export const PIDS_PER_BROWSER = 120;
const BASE_PIDS = 100;
export function pidsLimit(read: (f: string) => string = (f) => readFileSync(f, "utf8")): number | null {
  for (const f of ["/sys/fs/cgroup/pids.max", "/sys/fs/cgroup/pids/pids.max"]) {
    try { const v = read(f).trim(); if (/^\d+$/.test(v)) return Number(v); if (v === "max") return null; } catch { /* not this cgroup version */ }
  }
  return null;
}
/** As many browsers as the container's memory holds, and as its process cap allows (scale test, 12 Nov: a cap of 2048 tasks stopped new browsers at about seventeen with EAGAIN); an admin's number only caps it. */
export function slotsFor(limitMb: number, bound: number | undefined, pidsMax: number | null = null): number {
  const byMemory = Math.floor((limitMb - BASE_MB) / BROWSER_MB);
  const byTasks = pidsMax === null ? Infinity : Math.floor((pidsMax - BASE_PIDS) / PIDS_PER_BROWSER);
  const fit = Math.max(1, Math.min(byMemory, byTasks));
  return bound !== undefined && bound > 0 ? Math.min(fit, bound) : fit;
}
export type LaunchFn = (profileDir: string, extensionDir: string | null, log: (m: string) => void, o: ChromeOptions) => Chrome;
// headless=new reserves 87 px of the window for the browser's own bar, so the page gets 1280x800 from a window of 1280x887: every tab, new ones too, has the same viewport, which the live view's pointer maths relies on
export const VIEWPORT = { width: 1280, height: 800 };
const BAR_PX = 87;
// what a headless agent browser does not need at start and in the background (component downloads, safe-browsing lists, crash upload, metrics): with many browsers on a few cores these made every start slow
// (scale test, 12 Nov). Downloads, sign-ins, the extension and the pages themselves are untouched.
const QUIET_FLAGS = ["--disable-background-networking", "--disable-component-update", "--disable-domain-reliability", "--disable-breakpad", "--disable-client-side-phishing-detection", "--metrics-recording-only", "--no-pings"];
const realLaunch: LaunchFn = (dir, ext, log, o) => launchChrome(null, dir, ext, log, { headless: true, size: { width: VIEWPORT.width, height: VIEWPORT.height + BAR_PX }, ...o, flags: [...QUIET_FLAGS, ...(o.flags ?? [])], pipe: true });

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
  now?: () => number;
  launch?: LaunchFn;
  /** Extra browser flags and environment for one profile, such as its bridge folder (bridge.ts). Called each time the profile's browser starts. */
  extra?: (profileId: string) => ChromeOptions;
  /** How many browsers may be starting at the same moment (a start is mostly CPU; many at once on a few cores all crawl and time out). Default: the container's cores. */
  maxStarting?: number;
  /** How long resetChrome waits for a step in flight to finish before it refuses. Default 30 seconds. */
  resetWaitMs?: number;
  /** Called just before a profile's browser closes: the chance to note what it holds (the sites it is signed in to) so they can be listed while it sleeps. */
  onClosing?: (p: Profile) => Promise<void>;
  /** Called when a profile's browser is up: the start page's cookie and first tab (main.ts). */
  onStarted?: (profileId: string, chrome: Chrome) => Promise<void>;
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
  lastActiveAt: number;
  /** People watching its live view (view.ts counts them). */
  viewers: number;
  /** The agent this profile belongs to, as the Space said when it configured it. */
  agentId: string | undefined;
  /** The agent's name, for its start page. */
  agentName: string | undefined;
  spaceId: string | undefined;
  /** Which start of its browser this is (this browserd's boot and a count): new each time the browser starts, so a ref from a snapshot taken under an older start is known to be stale (fifth look). */
  startId: string;
  starting: Promise<void> | null;
  /** Chrome's data of an old computer is being put into the folder until then (resetChrome to importDone): the browser does not start meanwhile. */
  importingUntil: number;
  /** Downloads as the browser reports them: the ones under way, and when the last began and finished. */
  dl: { active: Set<string>; begunAt: number; doneAt: number };
  /** When the person at the controls last sent input through the live view: the only thing besides their own open view that keeps a takeover in use (the module's 15 minute rule). */
  personActiveAt: number;
  /** When a person last had it in front of them (a view opened or closed, a takeover began or ended, their input): a person's use keeps the browser longer than an agent's (sixth look C). */
  personSeenAt: number;
  /** The start of the browser a person last saw: one who takes over a browser reopened since is told its page was reloaded. */
  personSeenStart: string;
}

export interface ProfileRow { profileId: string; spaceId?: string; personSeenAt?: number; running: boolean; tabs: number; busy: boolean; takeover: boolean; viewers: number; lastActiveAt: number; held: number; paused: boolean; takeoverBy?: string; bridge?: { connected: number; hello: boolean; optin: boolean } }

export interface ProfileManager {
  /** The profile's record (made on first mention; no browser starts). */
  get(id: string): Profile;
  /** Start the profile's browser if it is not running, making room first. */
  ensure(id: string): Promise<Profile>;
  /** One browser tool for one profile. `by: "person"` is the person at the controls, through the live view. `channel`: the Vault as the person whose call it is (main.ts), for the handles this call types. */
  tool(a: { profileId: string; tool: string; args: Record<string, unknown>; timeoutMs: number; by?: string; channel?: CallChannel; refsFrom?: string; seenFrom?: string }): Promise<Record<string, unknown>>;
  /** The Space a profile belongs to, as the Space said: kept in the profile's folder too, so a purge of one Space finds its own profiles on disk, and only those. */
  setSpace(id: string, spaceId: string): void;
  /** Remove every profile of this Space (browsers closed first, cleanly), from what is on disk: removed, profiles of other Spaces, and profiles that name no Space (made before Spaces were written down). */
  purgeSpace(spaceId: string): Promise<{ removed: number; others: number; unmarked: number }>;
  /** Write the Space into the folders of these profiles that are on disk and name no Space yet (a Space's daemon, at its start, for its own agents: a sleeping agent's profile is marked too). */
  markSpace(spaceId: string, ids: readonly string[]): number;
  /** Close the least recently used browser of ANOTHER Space that is quiet (no step, nobody watching, nobody at the controls, nothing held) and has been for `quietMs`: for a Space whose own browsers are
   * all in use while this one is full of another Space's idle ones. The id closed, or null. */
  closeOther(spaceId: string, quietMs: number): Promise<string | null>;
  /** `reopened`: the browser started again since a person last saw it (or is not running and starts now): its page was reloaded. */
  takeover(id: string, personId: string): { reopened: boolean };
  /** A person has it in front of them now (a view opened or closed, their input). */
  personSaw(id: string): void;
  /** `before`: release only a takeover that began before then (a release decided on a reading taken at that time never undoes a takeover that came after it). */
  giveBack(id: string, before?: number): void;
  /** A call says a person holds the profile (the Space's table): browserd holds it too. A call never releases one: only give back and the Space's periodic pass do. */
  setHold(id: string, personId: string): void;
  /** Stop the browser, keep the folder. */
  stop(id: string): Promise<void>;
  /**
   * Stop the browser and empty the profile's Chrome folder, ready for Chrome's data from an old computer to be put there (migration). Never under a step in flight or a person at the controls: it waits for
   * the step to finish (resetWaitMs) and otherwise refuses, so the move is tried again later. Until importDone the browser does not start, so nothing writes into the folder while the data goes in.
   */
  resetChrome(id: string): Promise<void>;
  importDone(id: string): void;
  /** Stop the browser and delete the folder (the agent was removed). */
  forget(id: string): Promise<void>;
  /** One pass of the idle check; returns the profiles it stopped. Called on a timer by main.ts, and by tests. */
  sweep(): Promise<string[]>;
  list(): Promise<ProfileRow[]>;
  /** Close every browser (the container is stopping). */
  stopAll(): Promise<void>;
  /** For a viewer that is attached or gone: counts as activity. */
  touch(id: string): void;
  /** Has this profile ever held Chrome's data (its browser ran: Chrome made its Default folder) or a list of sign-ins? Reads the folder only: nothing starts, and a profile never seen is false. */
  used(id: string): boolean;
  /** The sites the profile was signed in to when its browser last closed or was last asked (a sleeping profile is listed from this; nothing starts). */
  cachedSessions(id: string): Array<{ site: string; since: number; lastSeen: number }>;
  saveSessions(id: string, rows: Array<{ site: string; since: number; lastSeen: number }>): void;
  /** What the profile's browser finished downloading and nobody has taken yet. Needs no browser. */
  downloads(id: string): DownloadRow[];
  /** One finished download's bytes (up to 20 MB). */
  downloadRead(id: string, name: string): Buffer;
  /** The download is in the agent's Files: it leaves this folder. */
  downloadAck(id: string, name: string): void;
  /** A download too large to move into Files: it leaves the list (kept in the profile's downloads-kept folder), so it is reported once and not tried again. */
  downloadKeep(id: string, name: string): void;
}

export function createProfileManager(o: ProfileManagerOptions): ProfileManager {
  const now = o.now ?? Date.now;
  const launch = o.launch ?? realLaunch;
  const maxRunning = o.maxRunning ?? 6;
  const idleMs = o.idleMs ?? 10 * 60_000;
  const profiles = new Map<string, Profile>();

  function get(idIn: string): Profile {
    const id = checkProfileId(idIn);
    let p = profiles.get(id);
    if (!p) {
      const dir = join(o.root, "profiles", id);
      p = {
        id, dir, vault: createVault(),
        state: { stopped: false, tabLimit: o.tabLimit ?? 10, takeover: null, busy: 0, caption: undefined },
        chrome: null, lastActiveAt: now(), viewers: 0, agentId: undefined, agentName: undefined, spaceId: spaceOnDisk(dir), startId: "", starting: null, importingUntil: 0, dl: { active: new Set(), begunAt: 0, doneAt: 0 }, personActiveAt: 0, personSeenAt: 0, personSeenStart: "",
      };
      profiles.set(id, p);
    }
    return p;
  }

  const downloadsOf = (p: Profile): string => join(p.dir, "downloads");
  const safeName = (name: string): string => { if (!SAFE_NAME.test(name) || name.endsWith(".crdownload")) throw badInput("That is not a download's name."); return name; };

  const running = (): Profile[] => [...profiles.values()].filter((p) => p.chrome !== null);
  // profiles whose browser is being started: they hold a place before their Chromium exists, so two that start at once cannot both take the last one
  const reserved = new Set<string>();
  const quiet = (p: Profile): boolean => p.state.busy === 0 && p.viewers === 0 && p.state.takeover === null;

  async function release(p: Profile): Promise<void> {
    const c = p.chrome;
    if (!c) return;
    p.chrome = null;
    p.dl.active.clear();
    try { p.chrome = c; await o.onClosing?.(p); } catch { /* the list taken last stays */ } finally { p.chrome = null; }
    // closed the way a person closes it, so a login that was just made is in the folder when the browser starts again
    await c.shutdown().catch(() => c.stop());
  }

  // one room check at a time: a check and the stop it may make are one step, so two browsers that start together never pick the same one to stop or both take the last place
  let roomTurn: Promise<void> = Promise.resolve();
  function makeRoom(except: string): Promise<void> {
    const turn = roomTurn.then(() => roomFor(except));
    roomTurn = turn.catch(() => undefined);
    return turn;
  }

  // browserd never closes a browser to make room (fourth look, 12 Nov): it cannot see a send held for a person's approval in another layer, a call on its way, or a turn in progress, and it serves every
  // Space on the container. When it is full it says so (reason browser_full) and the Space's module, which knows all of that, chooses which of its own browsers to close, or waits.
  async function roomFor(except: string): Promise<void> {
    const taken = (): number => running().length + [...reserved].filter((id) => id !== except && profiles.get(id)?.chrome === null).length;
    if (taken() < maxRunning) { reserved.add(except); return; }
    throw new AgentError("unavailable", "Every browser on this server is in use. Yours opens as soon as one is free.", "browser_full");
  }

  async function ensure(id: string): Promise<Profile> {
    const p = get(id);
    p.lastActiveAt = now();
    if (p.chrome?.alive()) return p;
    if (p.importingUntil > now()) throw unavailable("This agent's browser is taking in its sign-ins from its old computer. Try again in a minute.");
    if (p.starting) { await p.starting; return p; }
    p.starting = (async () => {
      try { await startIn(p); } finally { reserved.delete(p.id); }
    })();
    try { await p.starting; } finally { p.starting = null; }
    return p;
  }

  // starts take turns, a few at a time: twelve Chromiums launched at once on four cores each took 12 s and fourteen missed the 30 s start limit (scale test, 12 Nov); in turns each takes about one start's time
  const maxStarting = Math.max(1, o.maxStarting ?? cpuLimit());
  let starting = 0;
  const startQueue: Array<() => void> = [];
  async function startTurn<T>(f: () => Promise<T>): Promise<T> {
    if (starting >= maxStarting) await new Promise<void>((r) => startQueue.push(r));
    starting += 1;
    try { return await f(); } finally { starting -= 1; startQueue.shift()?.(); }
  }

  async function startIn(p: Profile): Promise<void> {
    await startTurn(() => startNow(p));
  }

  async function startNow(p: Profile): Promise<void> {
    {
      await makeRoom(p.id);
      if (p.chrome) await release(p);
      mkdirSync(join(p.dir, "chrome"), { recursive: true });
      mkdirSync(downloadsOf(p), { recursive: true });
      writeDownloadPrefs(join(p.dir, "chrome"), downloadsOf(p));
      const opts = { ...(o.extra?.(p.id) ?? {}), pipe: true };
      const c = launch(join(p.dir, "chrome"), o.extensionDir, o.log, opts);
      p.chrome = c;
      try { await c.ready(); } catch (e) { await release(p); throw e; }
      starts += 1;
      p.startId = `${BOOT}.${starts}`;
      // and the browser itself is told, so a download from a tab opened later goes the same way
      try {
        const b = await c.browser();
        try {
          // and says what it downloads, so a step can wait for the file it set off (the pipe's browser connection lives as long as the browser)
          b.on("Browser.downloadWillBegin", (e) => { p.dl.active.add(String(e["guid"])); p.dl.begunAt = Date.now(); });
          b.on("Browser.downloadProgress", (e) => { if (e["state"] === "completed" || e["state"] === "canceled") { p.dl.active.delete(String(e["guid"])); p.dl.doneAt = Date.now(); } });
          await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsOf(p), eventsEnabled: true }).catch(() => undefined);
        } finally { b.close(); }
      } catch { /* the preferences already say it; a fake browser in a test has no DevTools */ }
      await o.onStarted?.(p.id, c).catch((e: unknown) => o.log(`start page: ${e instanceof Error ? e.message : "failed"}`));
    }
  }

  async function tool(a: { profileId: string; tool: string; args: Record<string, unknown>; timeoutMs: number; by?: string; channel?: CallChannel; refsFrom?: string; seenFrom?: string }): Promise<Record<string, unknown>> {
    const p = get(a.profileId);
    const name = a.tool;
    if (!name.startsWith("chrome_")) throw badInput(`${name} is not a tool of the Space browser.`);
    const byPerson = a.by === "person" && p.state.takeover !== null;
    // A person at the controls: the agent's tools wait, except the two that only look.
    if (p.state.takeover && !byPerson && name !== "chrome_status" && name !== "chrome_stop") throw new AgentError("paused", "A person has the controls. The tools wait until they give them back.", "profile_held");
    const ms = Math.min(Math.max(a.timeoutMs, 1000), 130_000);
    // A look that needs no browser does not start one.
    if (name === "chrome_status" && !p.chrome?.alive()) return { connected: false, paused: p.state.stopped, held: [] };
    if ((name === "chrome_stop" || name === "chrome_resume" || name === "chrome_plan") && !p.chrome?.alive()) {
      if (name === "chrome_stop") { p.state.stopped = true; return { stopped: true }; }
      if (name === "chrome_resume") { const was = p.state.stopped; p.state.stopped = false; return { resumed: was }; }
      return { ok: true };
    }
    // An act on a page the agent has not seen (sixth look): the module sends the start of the browser its last answer came from (empty: it has none, after its own restart). When the browser has started
    // since, or is not running and would start now, its pages were reloaded: a coordinate click, a key, typed text or a script would land on a page the agent never looked at (a #Handle typed into
    // whatever field the reloaded page focuses). Refused before anything else: before the Vault is asked for a value, before a browser starts.
    if (typeof a.seenFrom === "string") {
      const current = p.chrome?.alive() ? p.startId : null;
      if (current === null || a.seenFrom !== current) { const e = new AgentError("bad_input", REOPENED_LINE, "browser_reopened"); e.start = current; throw e; }
    }
    const typing = name === "chrome_type" || name === "chrome_fill" || name === "chrome_act";
    // Handles are asked of the Vault before the browser starts: a refusal must not cost a Chromium.
    // a handle the call types is asked of the Vault as the person whose call it is (the call's own channel), never through whichever call came last
    const filled = typing ? await (a.channel ?? p.vault).fillArgs(a.args) : { args: a.args, used: [] };
    p.state.busy += 1;
    p.lastActiveAt = now();
    try {
      const prof = await ensure(p.id);
      const c = prof.chrome as Chrome;
      // an act on refs from a snapshot taken under an earlier start of this browser (closed to make room, or stopped when idle, and its pages reloaded since): those refs may name nothing, or another
      // element. Refused, every time, until a new snapshot is taken (the module sends the start its last snapshot was taken under)
      if (typeof a.refsFrom === "string" && a.refsFrom !== "" && a.refsFrom !== prof.startId) throw new AgentError("bad_input", REOPENED_LINE, "browser_reopened");
      const began = Date.now();
      const raw = await within(ms, name, () => c.tool(name, filled.args, prof.state));
      if (ACTING.has(name)) await settleDownloads(prof, began);
      const out = filled.used.length > 0 ? { ...scrubUsed(raw, filled.used), used: filled.used } : raw;
      p.state.caption = name.replace(/_/g, " ");
      if ((name === "chrome_open" || name === "chrome_state") && typeof out["url"] === "string") o.onPage?.(p.id, out["url"], typeof out["title"] === "string" ? out["title"] : "");
      return out;
    } finally { p.state.busy -= 1; p.lastActiveAt = now(); }
  }

  /** Only when the browser said a download began during the step (Browser.downloadWillBegin over the pipe): wait for it to finish, within a bound. */
  async function settleDownloads(p: Profile, began: number): Promise<void> {
    if (p.dl.begunAt < began || p.dl.active.size === 0) return;
    const t0 = Date.now();
    while (p.dl.active.size > 0 && Date.now() - t0 < SETTLE_MS) await new Promise((r) => setTimeout(r, 100));
  }

  return {
    get, ensure, tool,
    takeover(id, personId) {
      if (!personId) throw badInput("Say which person takes over.");
      const p = get(id);
      if (p.state.takeover && p.state.takeover.personId !== personId) throw badInput("Someone else has the controls.");
      p.state.takeover = { personId, since: now() };
      p.lastActiveAt = now();
      const current = p.chrome?.alive() ? p.startId : "";
      const reopened = p.personSeenStart !== "" && p.personSeenStart !== current;
      p.personSeenAt = now();
      if (current) p.personSeenStart = current;
      return { reopened };
    },
    personSaw(id) { const p = get(id); p.personSeenAt = now(); if (p.chrome?.alive() && p.startId) p.personSeenStart = p.startId; },
    giveBack(id, before) { const p = get(id); if (p.state.takeover && before !== undefined && p.state.takeover.since >= before) return; const had = p.state.takeover !== null; p.state.takeover = null; p.lastActiveAt = now(); if (had) p.personSeenAt = now(); },
    setHold(id, personId) {
      const p = get(id);
      if (p.state.takeover?.personId !== personId) p.state.takeover = { personId, since: now() };
    },
    async stop(id) { const p = profiles.get(checkProfileId(id)); if (p) { p.state.takeover = null; await release(p); } },
    async resetChrome(id) {
      const p = get(id);
      if (p.state.takeover) throw new AgentError("unavailable", "A person has the controls of this agent's browser: its sign-ins move from the old computer when they give it back.", "profile_held");
      const waitMs = o.resetWaitMs ?? 30_000;
      const t0 = Date.now();
      while ((p.state.busy > 0 || p.starting !== null) && Date.now() - t0 < waitMs) await new Promise((r) => setTimeout(r, 100));
      if (p.state.busy > 0 || p.starting !== null) throw new AgentError("unavailable", "This agent's browser is busy: its sign-ins move from the old computer at a quiet moment.", "profile_busy");
      p.importingUntil = now() + 5 * 60_000;
      await release(p);
      rmSync(join(p.dir, "chrome"), { recursive: true, force: true });
      mkdirSync(p.dir, { recursive: true });
    },
    importDone(id) { get(id).importingUntil = 0; },
    setSpace(id, spaceId) {
      const p = get(id);
      if (!/^[A-Za-z0-9_-]{3,80}$/.test(spaceId) || (p.spaceId === spaceId && existsSync(join(p.dir, SPACE_FILE)))) return;
      p.spaceId = spaceId;
      try { mkdirSync(p.dir, { recursive: true }); writeFileSync(join(p.dir, SPACE_FILE), spaceId); } catch { /* kept in memory; written at the next call */ }
    },
    markSpace(spaceId, ids) {
      if (!PROFILE_ID.test(spaceId)) return 0;
      let marked = 0;
      for (const id of ids) {
        if (!PROFILE_ID.test(id)) continue;
        const dir = join(o.root, "profiles", id);
        if (!existsSync(dir) || spaceOnDisk(dir) !== undefined) continue;
        try { writeFileSync(join(dir, SPACE_FILE), spaceId); marked += 1; const p = profiles.get(id); if (p && !p.spaceId) p.spaceId = spaceId; } catch { /* next start */ }
      }
      return marked;
    },
    async purgeSpace(spaceId) {
      let removed = 0, others = 0, unmarked = 0;
      const root = join(o.root, "profiles");
      const ids = existsSync(root) ? readdirSync(root) : [];
      for (const id of ids) {
        if (!PROFILE_ID.test(id)) continue;
        const sp = profiles.get(id)?.spaceId ?? spaceOnDisk(join(root, id));
        if (sp === spaceId) { await this.forget(id); removed += 1; } else if (sp) others += 1; else unmarked += 1;
      }
      return { removed, others, unmarked };
    },
    async closeOther(spaceId, quietMs) {
      const pick = running().filter((p) => p.spaceId !== undefined && p.spaceId !== spaceId && quiet(p) && (p.chrome?.heldIds().length ?? 0) === 0 && now() - p.lastActiveAt >= quietMs && now() - p.personSeenAt >= Math.max(quietMs, 60_000))
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
      if (!pick) return null;
      o.log(`profile ${pick.id} of another Space closed to make room`);
      await release(pick);
      return pick.id;
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
        rows.push({ profileId: p.id, ...(p.spaceId ? { spaceId: p.spaceId } : {}), running: alive, tabs, busy: p.state.busy > 0, takeover: p.state.takeover !== null, viewers: p.viewers, lastActiveAt: p.lastActiveAt, held: p.chrome?.heldIds().length ?? 0, paused: p.state.stopped, ...(p.state.takeover ? { takeoverBy: p.state.takeover.personId } : {}), ...(p.personSeenAt ? { personSeenAt: p.personSeenAt } : {}), ...(o.paired ? { bridge: o.paired(p.id) } : {}) });
      }
      return rows;
    },
    async stopAll() { await Promise.all([...profiles.values()].map((p) => release(p))); },
    used(id) {
      const dir = join(o.root, "profiles", checkProfileId(id));
      return existsSync(join(dir, "chrome", "Default")) || existsSync(join(dir, "sessions.json"));
    },
    cachedSessions(id) { try { const j = JSON.parse(readFileSync(join(get(id).dir, "sessions.json"), "utf8")) as Array<{ site: string; since: number; lastSeen: number }>; return Array.isArray(j) ? j : []; } catch { return []; } },
    saveSessions(id, rows) { try { mkdirSync(get(id).dir, { recursive: true }); writeFileSync(join(get(id).dir, "sessions.json"), JSON.stringify(rows)); } catch { /* not kept */ } },
    downloads(id) {
      const p = get(id);
      const dir = downloadsOf(p);
      if (!existsSync(dir)) return [];
      const rows: DownloadRow[] = [];
      for (const name of readdirSync(dir)) {
        if (!SAFE_NAME.test(name) || name.endsWith(".crdownload") || name.endsWith(".tmp")) continue;
        const st = statSync(join(dir, name));
        // a file Chrome wrote a moment ago may still be growing: it is taken once it has been quiet for a second, or at once when the browser said its downloads finished after it was written
        const finished = p.dl.active.size === 0 && p.dl.doneAt > 0 && p.dl.doneAt >= st.mtimeMs - 100;
        if (st.isFile() && (finished || now() - st.mtimeMs > 1000)) rows.push({ name, size: st.size, at: Math.round(st.mtimeMs) });
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
    downloadKeep(id, name) {
      const p = get(id);
      const from = join(downloadsOf(p), safeName(name));
      if (!existsSync(from)) throw notFound(`There is no download ${name}.`);
      const kept = join(p.dir, "downloads-kept");
      mkdirSync(kept, { recursive: true });
      renameSync(from, join(kept, name));
    },
    touch(id) { const p = profiles.get(id); if (p) p.lastActiveAt = now(); },
  };
}

