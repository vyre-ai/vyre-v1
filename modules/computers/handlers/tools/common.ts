// What every Chrome, Screen and Files tool of an agent computer does around the call to agentd (spec 2.7, ARCH 6.6, 6.11, 7.2): find the computer (an agent that leaves `computerId` out uses its own),
// check the caller may use it, wake it when it sleeps, keep the tools paused while a person has the controls, send one request to agentd, scrub what comes back, and add one step to the timeline.
//
// THE TOOL PROTOCOL (what images/agent-computer's agentd must answer, P-L2_17; one more action beside the ones in impl.ts):
//   tool   { tool: "<mcpName>", args: {...}, timeoutMs }  ->  { ...the capability's output..., used?: [{ handle, itemId, value }], frame?: <base64 png>, caption?: string }
//   `tool` is the capability's mcpName (chrome_click, screen_key, computer_files_read ...). agentd refuses what it cannot do with a JSON object on stderr, {"code","message"}, and a non-zero exit:
//   code "timeout" | "paused" (the person pressed Esc) | "not_found" | "bad_input" | "held" | "unavailable". `used` lists the Vault values it filled for #Handle.field references, so the
//   recording and every answer can be scrubbed; `frame` is the screen after the step (the timeline's picture); `caption` is its words.
// Errors are only ones the capabilities declare: a person at the controls, a held item and a bad argument are validation.bad_input; Esc, a computer still starting and a silent agentd are provider.unavailable.
// Handles are never resolved here: "agent computer logins stay on that computer" (ARCH 6.11), agentd substitutes them at the last moment and scrubs its own output. This module scrubs again.
import { retargetRead } from "../../../../host/src/seams/answer-reads.ts";
import { HostError } from "../../../../host/src/routes/errors.ts";
import { noteCallSecret } from "../../../../host/src/call-secrets.ts";
import {
  actorOf,
  addStep,
  agentFolder,
  boundFill,
  clean,
  hostFor,
  nodeOf,
  ensure,
  mintId,
  needComputer,
  needTeam,
  filledTabsOf,
  givenCount,
  handedSince,
  markFilledTab,
  raise,
  rememberSecrets,
  tabsOpen,
  rowsOf,
  setComputer,
} from "../../projections.ts";
import { personalChrome } from "../../projections.ts";
import type { CompCtx, ComputerHost, ComputerRow, PersonalChrome, Secret } from "../../projections.ts";
import { awaken } from "../lifecycle.ts";
import { askedThisTurn } from "./my-chrome-ask.ts";
import { spaceBrowser } from "../../sbrowser/port.ts";
import { profileIdOf } from "../../sbrowser/policy.ts";
import { takeDownloads } from "../../sbrowser/downloads.ts";
import {
  answerFrom,
  callEnded,
  callStarted,
  lastSeenStart,
  needRoom,
  refsStart,
  refusedAt,
  REOPENED_LINE,
  snapshotFrom,
} from "../../sbrowser/room.ts";

/** The steps that act on the page (anything but a look): each carries the start of the browser the agent last saw, and is refused after a reopen until the agent has seen the new page. */
const ACTS: ReadonlySet<string> = new Set([
  "chrome_click",
  "chrome_act",
  "chrome_type",
  "chrome_fill",
  "chrome_send",
  "chrome_api",
  "chrome_eval",
]);

/** Does a step name an element by a ref from a snapshot (a key "ref" anywhere in its arguments)? Such a step carries the start its refs were taken under, and browserd refuses it after a reopen. */
function namesRef(v: unknown, depth = 0): boolean {
  if (depth > 4 || v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some((x) => namesRef(x, depth + 1));
  return Object.entries(v as Record<string, unknown>).some(
    ([k, x]) => (k === "ref" && typeof x === "string" && x !== "") || namesRef(x, depth + 1),
  );
}
import { currentHold, DURING_HOLD, HELD_LINE, heldBy } from "../../sbrowser/hold.ts";
import { agentInfo } from "../../sbrowser/agentinfo.ts";
import { faceSvg } from "../../sbrowser/face.ts";
import { waitingNote } from "../../capacity.ts";
import { moveOf, settleMove } from "../../migrate.ts";
import { fitPngOffLoop, scaledNote } from "../../png-fit.ts";

export type ToolArgs = Record<string, unknown>;
export type ToolAnswer = Record<string, unknown>;

/** The code agentd gave for a refusal. */
export type ToolCode = "timeout" | "paused" | "not_found" | "bad_input" | "held" | "unavailable";

/** A reason that travels with a refusal and never changes with its wording: `profile_held` (a person has the controls), `profile_busy` (a step is running). Lane f-desktop's move matches on it. */
export type ToolReason = "profile_held" | "profile_busy" | "browser_full" | "browser_reopened";

export class ToolError extends Error {
  readonly code: ToolCode;
  readonly reason: ToolReason | undefined;
  /** browser_reopened: the start of the agent's browser now (null: not running), from browserd. */
  start: string | null | undefined;
  constructor(code: ToolCode, message: string, reason?: ToolReason) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.reason = reason;
  }
}

/** What the host binds on top of ComputerHost for the tools; the Docker host (impl.ts) has it. */
export interface ToolHost {
  /** `by: "person"` is the person at the controls acting through the live view: agentd lets it through a take-over that holds the agent's tools. */
  tool(a: { computerId: string; tool: string; args: ToolArgs; timeoutMs: number; by?: "person" }): Promise<ToolAnswer>;
}

export const DEFAULT_TOOL_MS = 30_000;
/** The longest a single tool call may take (chrome_wait allows two minutes). */
export const MAX_TOOL_MS = 130_000;

export interface ToolSpec {
  /** The capability's mcpName; this is what agentd is asked to run. */
  name: string;
  /** The timeline caption for this step, or null for a call that is only a look (no step). */
  caption: ((args: ToolArgs, out: ToolAnswer) => string) | null;
  /** Do not wake a sleeping computer; answer with `asleep` instead. */
  noWake?: boolean;
  /** Runs while a person has the controls. */
  duringTakeover?: boolean;
  timeoutMs?: number;
  /** What the answer is when the computer is asleep and `noWake` is set. */
  asleep?: ToolAnswer;
}

function toolHost(ctx: CompCtx, computerId: string): ComputerHost & ToolHost {
  const host = hostFor(ctx, computerId) as (ComputerHost & Partial<ToolHost>) | null;
  if (!host) raise(ctx, "provider.unavailable", "Agent computers are not running on this host.");
  if (typeof host.tool !== "function")
    raise(ctx, "provider.unavailable", "This host cannot run tools on an agent computer.");
  return host as ComputerHost & ToolHost;
}

/**
 * What an agent with no old-style desktop is told when a tool needs one. Agents no longer get a desktop (6 Nov): they have a terminal in their workspace and a browser in the Space browser, so each line
 * names the tool that works for what the call was after, in words an agent can pass on to a person. `tool` is the tool's name; any other call gets the general line.
 */
export function noDesktopLine(tool: string | undefined): string {
  if (tool !== undefined && tool.startsWith("chrome_")) {
    return "This Space has no browser for agents right now: the container runtime (Docker) does not answer on the computer this Space runs on, and the Space browser needs it. Docker on that computer, or a server with Docker added in Console > Computers, gives agents a browser. Tell the person that. Use their own Chrome only if they ask for it.";
  }
  if (tool !== undefined && tool.startsWith("screen_")) {
    return "You have no desktop screen: the screen tools work only on an old-style agent computer, and agents no longer get one. To work on a web page use chrome_open, chrome_snapshot and chrome_act in the Space browser. To run commands use terminal_run in your workspace.";
  }
  if (tool !== undefined && tool.startsWith("computer_files_")) {
    return "You have no desktop computer for these file tools to read. Your Files folder is in Files: use the files tools, or terminal_run to work with it in your workspace.";
  }
  return "You have no desktop computer, and agents no longer get one. You have a terminal in your workspace (terminal_run) and a browser in the Space browser (chrome_open, chrome_snapshot).";
}

/** What an agent is told when it calls a desktop tool and its older desktop has already moved to its workspace and browser. */
export function movedDesktopLine(tool: string | undefined): string {
  return tool !== undefined && tool.startsWith("computer_files_")
    ? "Your older desktop has moved to your workspace and your browser, so these file tools no longer work. Your Files folder is in Files: use the files tools, or terminal_run to work with it in your workspace."
    : "Your older desktop has moved to your workspace and your browser, so the screen tools no longer work. To work on a web page use chrome_open, chrome_snapshot and chrome_act. To run commands use terminal_run.";
}

/** The computer a tool call is for: the one named, else the caller's own (an agent that still has an old desktop). */
export function computerFor(ctx: CompCtx, computerId: string | undefined, tool?: string): ComputerRow {
  if (computerId) return needComputer(ctx, computerId);
  if (ctx.principal.kind !== "agent")
    raise(ctx, "validation.bad_input", "Say which computer. Only an agent can leave it out.");
  const r = rowsOf(ctx.db, "SELECT computer_id FROM computers_computers WHERE agent_id = ?", ctx.principal.id)[0];
  if (!r) raise(ctx, "validation.not_found", noDesktopLine(tool), { agentId: ctx.principal.id });
  // the id left out (the gateway bound the call to the Space): the same question the named spelling asks at the gateway is asked here, on this computer, so an admin's deny on it stops both ways in
  const own = String(r["computer_id"]);
  if (ctx.authorize({ perm: "computers.use", level: "use" }, { type: "computer", id: own }).effect !== "allow")
    raise(ctx, "permission.no_grant", "This agent may not use its computer right now.", { computerId: own });
  return needComputer(ctx, own);
}

function mayUse(ctx: CompCtx, c: ComputerRow): void {
  if (ctx.principal.kind === "agent" && ctx.principal.id === c.agentId) return;
  if (ctx.authorize({ perm: "computers.use", level: "use" }, { type: "computer", id: c.computerId }).effect !== "allow")
    raise(ctx, "permission.no_grant", "You cannot use this agent's computer.");
}

const CODES = {
  timeout: "timeout.deadline",
  paused: "provider.unavailable",
  not_found: "validation.not_found",
  bad_input: "validation.bad_input",
  held: "validation.bad_input",
  unavailable: "provider.unavailable",
} as const;

/**
 * A refusal, in the words the computer gave, with every Vault value given to that computer or profile taken out first (review 12 Nov, finding 1: a page's own exception, or agentd's "the page
 * raised: ...", can quote a filled field). Every error of every tool goes through here, as every answer goes through scrubDeep.
 */
function refuse(ctx: CompCtx, e: unknown, computerId: string, extra: Record<string, unknown> = {}): never {
  if (e instanceof ToolError) {
    // "paused" is two things: the person pressed Esc (the Chrome extension), or a person has taken over the browser and holds the controls (the Space browser says so in its own words, and those are the true reason)
    const text =
      e.code === "paused" && !/has the controls/i.test(e.message)
        ? "Chrome is paused. The person pressed Esc; wait for their answer, then resume."
        : clean(computerId, e.message).slice(0, 300);
    // a refusal's stable reason (profile_held, profile_busy) travels with it, whatever its words
    raise(ctx, CODES[e.code], text, { agentd: e.code, ...(e.reason ? { reason: e.reason } : {}), ...extra });
  }
  raise(ctx, "provider.unavailable", "The computer did not answer the tool.", {
    reason: e instanceof Error ? clean(computerId, e.message).slice(0, 200) : "unknown",
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The tabs of a computer or profile as its browser lists them now. */
type TabLister = () => Promise<Array<{ tabId: string; active: boolean }>>;
const tabsIn = (out: unknown): Array<{ tabId: string; active: boolean }> =>
  isRecord(out) && Array.isArray(out["tabs"])
    ? (out["tabs"] as unknown[])
        .filter(isRecord)
        .filter((t) => typeof t["tabId"] === "string")
        .map((t) => ({ tabId: String(t["tabId"]), active: t["active"] === true }))
    : [];

/** May the tab named (or the one in front) be pictured? Not while it holds a value filled from the Vault; when the browser cannot say which tab is in front, no. */
async function pictureAllowed(id: string, list: TabLister, tabId: unknown): Promise<boolean> {
  if (filledTabsOf(id).size === 0) return true;
  let tabs: Array<{ tabId: string; active: boolean }>;
  try {
    tabs = await list();
  } catch {
    return false;
  }
  // a browser always has a tab: an empty list says nothing about which were closed
  if (tabs.length === 0) return false;
  tabsOpen(
    id,
    tabs.map((t) => t.tabId),
  );
  const marks = filledTabsOf(id);
  if (marks.size === 0) return true;
  if (marks.has("*")) return false;
  const target = typeof tabId === "string" ? tabId : tabs.find((t) => t.active)?.tabId;
  return target !== undefined && !marks.has(target);
}

/**
 * After a call during which a value was handed to this computer: mark the tab it went into. A value the call itself typed went into the tab it named, else the one in front. A value Vyre for Chrome
 * filled on its own (an autofill while a page loaded) may be in any tab, including one in the background the call did not aim at, so every tab open now is marked (second look, b). When the
 * tabs cannot be listed, "*" holds them all until they can.
 */
async function markAfter(
  id: string,
  list: TabLister,
  before: number,
  tabId: unknown,
  typed: readonly string[],
): Promise<void> {
  // a value the call typed is handed out by the channel and reported in `used`: one fill, not two (third look); a hand-out the call did not type is Vyre for Chrome's own
  const handed = handedSince(id, before);
  const mine = new Set(typed);
  const byExtension = handed.some((v) => !mine.has(v));
  if (typed.length === 0 && !byExtension) return;
  let tabs: Array<{ tabId: string; active: boolean }> | null = null;
  try {
    tabs = await list();
  } catch {
    /* the tabs cannot be told */
  }
  if (tabs === null || tabs.length === 0) {
    markFilledTab(id, "*");
    return;
  }
  if (byExtension) {
    for (const t of tabs) markFilledTab(id, t.tabId);
    return;
  }
  const target = typeof tabId === "string" ? tabId : tabs.find((t) => t.active)?.tabId;
  markFilledTab(id, target ?? "*");
}

/** Every string anywhere in a value with the Vault values filled on this computer removed. */
export function scrubDeep(computerId: string, v: unknown): unknown {
  if (typeof v === "string") return clean(computerId, v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(computerId, x));
  if (isRecord(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = scrubDeep(computerId, x);
    return out;
  }
  return v;
}

function secretsOf(v: unknown): Secret[] {
  if (!Array.isArray(v)) return [];
  const out: Secret[] = [];
  for (const x of v) {
    if (
      isRecord(x) &&
      typeof x["handle"] === "string" &&
      typeof x["itemId"] === "string" &&
      typeof x["value"] === "string" &&
      x["value"].length >= 4
    )
      out.push({ handle: x["handle"], itemId: x["itemId"], value: x["value"] });
  }
  return out;
}

async function keepFrame(ctx: CompCtx, c: ComputerRow, frame: unknown, at: number): Promise<string | undefined> {
  if (typeof frame !== "string" || frame === "") return undefined;
  try {
    const folderId = await agentFolder(ctx, c.agentId);
    if (!folderId) return undefined;
    // a heavy page's picture is over the size limit for a direct write to Files: it is kept scaled down, not lost
    const fit = await fitPngOffLoop(frame, { width: 0, height: 0 });
    if (!fit.ok) return undefined;
    frame = fit.shot.base64;
    const made = (await ctx.call("files.create", {
      folderId,
      name: `step-${new Date(at).toISOString().replace(/[:.]/g, "-")}.png`,
      kind: "image",
      mime: "image/png",
      content: { base64: frame },
      idempotencyKey: `cmpstep:${c.computerId}:${mintId("stp", at)}`,
    })) as { file?: { fileId?: string } };
    return made.file?.fileId;
  } catch {
    return undefined;
  }
}

// The live card (rc.9): the first thing an agent does on its computer for a chat puts one message in that chat, a screenshot block marked live. The chat draws it as the computer's live view while the
// computer works and as the last picture afterwards. One card per chat and computer for a burst of work; a new burst (ten quiet minutes) gets a new one. Posting never fails the tool call.
const LIVE_GAP_MS = 10 * 60_000;
const lastCard = new Map<string, number>();
async function liveCard(
  ctx: CompCtx,
  c: ComputerRow,
  caption: string,
  fileId: string | undefined,
  at: number,
): Promise<void> {
  if (!ctx.thread || ctx.principal.kind !== "agent" || !fileId) return;
  const key = `${c.computerId}|${ctx.thread}`;
  const prev = lastCard.get(key);
  lastCard.set(key, at);
  if (prev !== undefined && at - prev < LIVE_GAP_MS) return;
  try {
    await ctx.call("chat.post", {
      threadId: ctx.thread,
      body: "",
      mentions: [],
      idempotencyKey: `cmplive:${c.computerId}:${ctx.thread}:${Math.floor(at / LIVE_GAP_MS)}`,
      blocks: [{ type: "screenshot", v: 1, data: { computerId: c.computerId, fileId, caption, at, live: true } }],
    });
  } catch {
    lastCard.delete(key);
  }
}

// Is the Space browser usable on this host (the container runtime answers)? Asked at most every 15 seconds. When it is not, an agent keeps browsing where it did before.
let usable: { sb: unknown; at: number; ok: boolean } | null = null;
async function browserUsable(sb: NonNullable<ReturnType<typeof spaceBrowser>>, now: number): Promise<boolean> {
  if (usable && usable.sb === sb && now - usable.at < 15_000) return usable.ok;
  const ok = await sb.available().catch(() => false);
  usable = { sb, at: now, ok };
  return ok;
}

/** Would this step post the chat's live card for the agent's Space browser (the first of a burst), had it a picture? */
function cardDue(ctx: CompCtx, agentId: string, at: number): boolean {
  if (!ctx.thread || ctx.principal.kind !== "agent") return false;
  const prev = lastCard.get(`browser|${agentId}|${ctx.thread}`);
  return prev === undefined || at - prev >= LIVE_GAP_MS;
}

/** The chat's live card for work in an agent's Space browser: one per burst of ten quiet minutes. Posting never fails the tool call. */
async function browserCard(
  ctx: CompCtx,
  agentId: string,
  caption: string,
  fileId: string | undefined,
  at: number,
): Promise<void> {
  if (!ctx.thread || ctx.principal.kind !== "agent" || !fileId) return;
  const key = `browser|${agentId}|${ctx.thread}`;
  const prev = lastCard.get(key);
  lastCard.set(key, at);
  if (prev !== undefined && at - prev < LIVE_GAP_MS) return;
  try {
    await ctx.call("chat.post", {
      threadId: ctx.thread,
      body: "",
      mentions: [],
      idempotencyKey: `sbrlive:${agentId}:${ctx.thread}:${Math.floor(at / LIVE_GAP_MS)}`,
      blocks: [{ type: "browser_screenshot", v: 1, data: { agentId, fileId, caption, at, live: true } }],
    });
  } catch {
    lastCard.delete(key);
  }
}

export interface Resolved {
  computer: ComputerRow;
  host: ComputerHost & ToolHost;
  /** The person's own Chrome, not an agent computer. */ personal?: boolean;
  /** The agent's profile in the Space browser (sbrowser/): a Chrome of its own on the Space host, no computer needed. */ browser?: {
    profileId: string;
  };
}

/** Name this as `computerId` to work in the person's own Chrome. An agent with no computer of its own gets it without naming it, when the person has opened their Chrome to agents. */
export const MY_CHROME = "my-chrome";

const stub = (ctx: CompCtx): ComputerRow =>
  ({ computerId: MY_CHROME, agentId: ctx.principal.id, state: "working" }) as unknown as ComputerRow;

/** Tools that never need the ask of this turn: they finish or stop what an ask already began (a held item waiting for the person, Stop, Resume, and the look at whether Chrome is connected). */
const NO_ASK = new Set(["chrome_send", "chrome_stop", "chrome_resume", "chrome_status"]);
/** Calls that only look or stop: they never start the move of an old desktop. */
const LOOKS = new Set(["chrome_status", "chrome_stop", "chrome_resume"]);

/** Where a call goes: `inMyChrome: true` is the way to ask for the person's Chrome; the older spelling `computerId: "my-chrome"` means the same. */
export const whereOf = (input: {
  computerId?: string | undefined;
  inMyChrome?: boolean | undefined;
}): string | undefined => (input.inMyChrome === true ? MY_CHROME : input.computerId);

const NOT_ASKED =
  "The person did not ask for their own Chrome in this turn, so it is not used. Work in the Space browser. If their own Chrome is what the task needs, ask them with ask_question: Use my Chrome, or Use the Space browser.";
const NOT_CONNECTED =
  "Your Chrome is not connected: Vyre for Chrome is not open on your computer, or it is not turned on for agents in this Space. I can do this in the Space browser instead. Tell the person that plainly and offer it.";

/** Is this call for the person's Chrome? Only when the call asks for it (`inMyChrome`), the person asked for it in this turn, and the Chrome is the one of the person the agent works for and is open to agents. Never by default. */
async function wantsMyChrome(ctx: CompCtx, computerId: string | undefined, tool?: string): Promise<boolean> {
  const asked = computerId === MY_CHROME;
  if (!asked) return false;
  if (ctx.principal.kind !== "agent")
    raise(
      ctx,
      "validation.bad_input",
      "Your Chrome is for an agent working for you. Say which agent computer you mean.",
    );
  const person = ctx.actingFor;
  if (!person)
    raise(
      ctx,
      "validation.bad_input",
      "Your Chrome is the Chrome of the person you work for, and this work is not for anyone.",
    );
  if (!(tool && NO_ASK.has(tool)) && !(await askedThisTurn(ctx)))
    raise(ctx, "validation.bad_input", NOT_ASKED, { reason: "not_asked" });
  const port = personalChrome();
  if (!port || !(await port.available({ space: ctx.space, person })))
    raise(ctx, "provider.unavailable", NOT_CONNECTED, { reason: "not_connected" });
  return true;
}

/** Everything before the call: team Space, the computer, the caller's right to it, awake, and the controls with the agent. Returns null when the spec says to leave a sleeping computer alone. */
export async function prepare(
  ctx: CompCtx,
  computerId: string | undefined,
  spec: Pick<ToolSpec, "noWake" | "duringTakeover"> & { name?: string },
): Promise<Resolved | null> {
  ensure(ctx.db);
  needTeam(ctx);
  // The person's own Chrome, when they asked for it this turn, comes before the Space browser.
  if (await wantsMyChrome(ctx, computerId, spec.name))
    return { computer: stub(ctx), host: {} as ComputerHost & ToolHost, personal: true };
  // The Space browser is where an agent browses by default (owner decision 6 Nov): its own profile, on the Space host, whoever asked, so the person's computer is never disturbed and a team agent's logins
  // outlive the person who asked. Only a call that names a computer (a person working one) or the person's own Chrome (`my-chrome`, on request) goes elsewhere.
  // An agent that still has an old desktop moves to the Space browser only after that desktop's sign-ins have moved into its profile (migrate.ts settleMove); until then its browser calls stay on the desktop.
  if (
    spec.name !== undefined &&
    spec.name.startsWith("chrome_") &&
    computerId === undefined &&
    ctx.principal.kind === "agent" &&
    spaceBrowser() &&
    (await browserUsable(spaceBrowser()!, ctx.now())) &&
    (await settleMove(ctx, ctx.principal.id, { start: !LOOKS.has(spec.name) }))
  ) {
    const profileId = profileIdOf(ctx.principal.id);
    if (!profileId)
      raise(ctx, "validation.bad_input", "This agent cannot have a browser profile: its id is not valid.");
    return {
      computer: { computerId: profileId, agentId: ctx.principal.id, state: "working" } as unknown as ComputerRow,
      host: {} as ComputerHost & ToolHost,
      browser: { profileId },
    };
  }
  let c = computerFor(ctx, computerId, spec.name);
  // a desktop whose sign-ins have moved is retired: the screen and file tools tell the agent what to use now (a person removes the desktop)
  if (
    computerId === undefined &&
    ctx.principal.kind === "agent" &&
    (spec.name?.startsWith("screen_") || spec.name?.startsWith("computer_files_")) &&
    moveOf(ctx, c.computerId)?.state === "done"
  ) {
    raise(ctx, "validation.not_found", movedDesktopLine(spec.name), { agentId: ctx.principal.id });
  }
  mayUse(ctx, c);
  // a chrome call the gateway took for the agent's Space browser goes to its computer (the browser is not usable): the answer check and the audit name that computer (review A2)
  if (
    spec.name !== undefined &&
    spec.name.startsWith("chrome_") &&
    computerId === undefined &&
    ctx.principal.kind === "agent"
  ) {
    retargetRead({
      thread: ctx.thread,
      agent: ctx.principal.id,
      asker: ctx.actingFor,
      traceId: ctx.trace.traceId,
      computerId: c.computerId,
    });
  }
  // The controls are the person's: the tools wait for an agent, never for the person at the controls (their own click or key through the live view is a tool call as them).
  const atTheControls = ctx.principal.kind === "person" && c.takeoverBy !== undefined && actorOf(ctx) === c.takeoverBy;
  if (c.state === "takeover" && !spec.duringTakeover && !atTheControls)
    raise(ctx, "validation.bad_input", "A person has the controls. The tools wait until they give them back.", {
      takeoverBy: c.takeoverBy,
    });
  if (c.state === "asleep" && spec.noWake) return null;
  if (c.state === "asleep" || c.state === "error") c = await awaken(ctx, c, actorOf(ctx));
  if (c.state === "provisioning" || c.state === "waking")
    raise(ctx, "provider.unavailable", waitingNote(ctx.db, c.computerId) ?? "This computer is still starting.");
  return { computer: c, host: toolHost(ctx, c.computerId) };
}

/** One call to agentd and everything after it: scrub, remember what was filled, keep the frame, add the step. Returns the capability's output. */
// The Vault channel of an older desktop acts for the person whose turn is using it, for as long as that turn's calls run, as the Space browser's does (a token per turn): never for the agent's owner for the
// computer's whole life. With no person behind the call there is no channel at all. agentd holds one filler, so one person's calls hold the desktop's channel at a time; another person's call waits briefly,
// then says so. A token that ended leaves agentd holding a dead one, which the host refuses.
// ---- the Vault channel of one person's turn, for the Space browser and for an older desktop: one slot-first lease
interface Slot {
  token: string;
  calls: number;
  revoke(): void;
  extend?(): void;
  pause?(): void;
  resume?(): void;
  ready: Promise<boolean>;
  err?: unknown;
  timer?: ReturnType<typeof setTimeout>;
}
interface Made {
  token: string;
  revoke(): void;
  extend?(): void;
  pause?(): void;
  resume?(): void;
}
/** A token for a turn's calls cannot outlive the call's own time limit by more than this: a revoke that is missed is never for ever. */
const TOKEN_TTL_MS = MAX_TOOL_MS + 30_000;
function dropSlot(slots: Map<string, Slot>, key: string, s: Slot): void {
  if (s.timer) clearTimeout(s.timer);
  if (slots.get(key) === s) slots.delete(key);
  s.revoke();
}
/**
 * One token per key, for as long as calls use it. The slot is taken before anything is awaited, so calls that start together share one token; a call that joins a slot another call dropped meanwhile takes a
 * fresh one; the token is extended each time a call joins (its ttl starts again) and revoked once, when the last call has ended. With `lingerMs` the token is only paused for that long after the last call
 * (it answers nothing, 401), so the next call of the same person resumes it without making another; then it is revoked. `make` issues the token and does what has to be done with it; a failure is returned as null,
 * or thrown when `throwErrors`.
 */
async function turnLease(
  slots: Map<string, Slot>,
  key: string,
  make: () => Promise<Made>,
  o: { lingerMs?: number; throwErrors?: boolean } = {},
): Promise<{ token: string; done(): void } | null> {
  const lease = (s: Slot): { token: string; done(): void } => ({
    token: s.token,
    done() {
      s.calls -= 1;
      if (s.calls > 0 || slots.get(key) !== s) return;
      if (o.lingerMs !== undefined && o.lingerMs > 0) {
        s.pause?.();
        s.timer = setTimeout(() => dropSlot(slots, key, s), o.lingerMs);
        s.timer.unref?.();
        return;
      }
      dropSlot(slots, key, s);
    },
  });
  for (;;) {
    const held = slots.get(key);
    if (held) {
      held.calls += 1; // counted at once, so the slot cannot be dropped under this call while it waits
      if (!(await held.ready)) {
        held.calls -= 1;
        if (o.throwErrors && held.err !== undefined) throw held.err;
        return null;
      }
      if (slots.get(key) !== held) {
        held.calls -= 1;
        continue;
      } // dropped in the meantime: a fresh slot
      if (held.timer) {
        clearTimeout(held.timer);
        delete held.timer;
      }
      held.resume?.();
      held.extend?.();
      return lease(held);
    }
    const s: Slot = { token: "", calls: 1, revoke: () => undefined, ready: Promise.resolve(false) };
    s.ready = (async () => {
      try {
        const m = await make();
        s.token = m.token;
        s.revoke = m.revoke;
        if (m.extend) s.extend = m.extend;
        if (m.pause) s.pause = m.pause;
        if (m.resume) s.resume = m.resume;
        return true;
      } catch (e) {
        s.err = e;
        if (slots.get(key) === s) slots.delete(key);
        s.revoke();
        return false;
      }
    })();
    slots.set(key, s);
    if (!(await s.ready)) {
      if (o.throwErrors && s.err !== undefined) throw s.err;
      return null;
    }
    return lease(s);
  }
}

// An older desktop: its Vault channel acts for the person whose turn is using it, for as long as that turn's calls run, as the Space browser's does: never for the agent's owner for the computer's whole life.
// With no person behind the call there is no channel at all. agentd holds one filler, so one person's calls hold the desktop's channel at a time; another person's call waits briefly, then says so. A token that
// ended leaves agentd holding a dead one, which the host refuses.
const deskSlots = new Map<string, Slot>();
let fillWaitMs = 5_000;
/** For tests: how long a person's call waits for another person's calls on the same desktop. */
export function setFillWait(ms: number | null): void {
  fillWaitMs = ms ?? 5_000;
}
/** On a computer that joined the Space, configuring agentd is a node job (up to one poll away), so the same person's next call within this time reuses the channel (paused between calls) instead of making another. */
let lingerMs = 15_000;
/** For tests. */
export function setFillLinger(ms: number | null): void {
  lingerMs = ms ?? 15_000;
}
export async function leaseFill(ctx: CompCtx, c: ComputerRow, host: ComputerHost): Promise<{ done(): void } | null> {
  const binding = boundFill();
  if (!binding) return null;
  if (ctx.principal.kind === "agent" && ctx.actingFor === undefined) return null; // no turn, no Vault
  const asker = actorOf(ctx);
  const node = nodeOf(ctx.db, c.computerId);
  // a computer on a server of the person's reaches the Space over a network link: it gets a channel only when that link is private
  if (node !== null && binding.nodeSecure?.(node) !== true) return null;
  const mine = `${c.computerId}|${asker}`;
  const until = Date.now() + fillWaitMs;
  for (;;) {
    const other = [...deskSlots].find(([k]) => k.startsWith(`${c.computerId}|`) && k !== mine);
    if (!other) break;
    if (other[1].calls <= 0) {
      dropSlot(deskSlots, other[0], other[1]);
      continue;
    } // another person's channel that only lingers: ended at once
    if (Date.now() >= until)
      raise(
        ctx,
        "provider.unavailable",
        "Someone else's request is using this desktop's Vault channel right now. Try again in a moment.",
      );
    await new Promise((res) => setTimeout(res, 50));
  }
  const l = await turnLease(
    deskSlots,
    mine,
    async () => {
      const issued = await binding.issue({
        computerId: c.computerId,
        agentId: c.agentId,
        asker,
        turn: true,
        ttlMs: TOKEN_TTL_MS,
        ...(node !== null ? { nodeId: node } : {}),
      });
      try {
        await host.configure({
          computerId: c.computerId,
          tabLimit: c.tabLimit,
          fillUrl: binding.url(),
          fillToken: issued.fillToken,
        });
      } catch (e) {
        issued.revoke();
        throw e;
      }
      return {
        token: issued.fillToken,
        revoke: issued.revoke,
        ...(issued.extend ? { extend: issued.extend } : {}),
        ...(issued.pause ? { pause: issued.pause } : {}),
        ...(issued.resume ? { resume: issued.resume } : {}),
      };
    },
    { lingerMs: node !== null ? lingerMs : 0 },
  );
  return l ? { done: l.done } : null;
}

export async function call(ctx: CompCtx, r: Resolved, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  if (r.personal) return personalCall(ctx, spec, args);
  if (r.browser) return browserCall(ctx, r.browser.profileId, spec, args);
  const c = r.computer;
  const list: TabLister = async () =>
    tabsIn(
      await r.host.tool({
        computerId: c.computerId,
        tool: "chrome_tabs",
        args: { action: "list" },
        timeoutMs: DEFAULT_TOOL_MS,
      }),
    );
  // a tab that holds a value filled from the Vault is not pictured: a text field (an API key, a one-time code) shows what it holds, and a picture cannot be scrubbed
  if (spec.name === "chrome_screenshot" && !(await pictureAllowed(c.computerId, list, args["tabId"])))
    raise(ctx, "validation.bad_input", HOLDS_VALUE, { reason: "vault_value_on_page" });
  const given = givenCount(c.computerId);
  let raw: ToolAnswer;
  const lease = await leaseFill(ctx, c, r.host);
  try {
    const byPerson =
      c.state === "takeover" &&
      ctx.principal.kind === "person" &&
      c.takeoverBy !== undefined &&
      actorOf(ctx) === c.takeoverBy;
    raw = await r.host.tool({
      computerId: c.computerId,
      tool: spec.name,
      args,
      timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS),
      ...(byPerson ? { by: "person" as const } : {}),
    });
  } catch (e) {
    return refuse(ctx, e, c.computerId);
  } finally {
    lease?.done();
  }
  if (!isRecord(raw)) raise(ctx, "provider.unavailable", "The computer answered with something that is not an object.");
  const { used, frame, caption, ...rest } = raw;
  rememberSecrets(c.computerId, secretsOf(used), { handedOut: false });
  for (const x of secretsOf(used)) noteCallSecret(ctx.trace.traceId, x.value); // an error later in this call is logged without them
  if (spec.name.startsWith("chrome_"))
    await markAfter(
      c.computerId,
      list,
      given,
      args["tabId"],
      secretsOf(used).map((x) => x.value),
    );
  if (spec.name === "chrome_tabs" && tabsIn(rest).length > 0)
    tabsOpen(
      c.computerId,
      tabsIn(rest).map((t) => t.tabId),
    );
  const out = scrubDeep(c.computerId, rest) as ToolAnswer;
  const at = ctx.now();
  setComputer(ctx.db, c.computerId, { last_active_at: at });
  if (spec.caption) {
    const words =
      typeof caption === "string" && caption.trim() !== ""
        ? clean(c.computerId, caption.trim()).slice(0, 200)
        : spec.caption(args, out);
    const frameFileId =
      filledTabsOf(c.computerId).size > 0 && !(await pictureAllowed(c.computerId, list, undefined))
        ? undefined
        : await keepFrame(ctx, c, frame, at);
    addStep(ctx.db, c.computerId, at, {
      by: ctx.principal.kind === "agent" ? "agent" : "person",
      caption: words,
      tool: spec.name,
      ...(frameFileId ? { frameFileId } : {}),
      ...(ctx.run ? { runId: ctx.run } : {}),
      ...(ctx.thread ? { threadId: ctx.thread } : {}),
    });
    await liveCard(ctx, c, words, frameFileId, at);
  }
  return out;
}

export const HOLDS_VALUE =
  "This tab holds a value filled from the Vault, so no picture of it is taken while it is open. Close that tab to have pictures of it again, or picture another tab.";
/** The line a step shows where its picture would be, when the tab in front held a Vault value (second look, c). */
const NO_PICTURE = "No picture: a Vault value is on this page";
const NO_PICTURE_OR_CARD = "No picture here or in the chat: a Vault value is on this page";

// The Vault channel of an agent's profile rides each tool call, as the person whose turn the call is (sbrowser audit bug 5): a token per profile and asker, live only while that person's calls run, so
// one team agent working for two people at once looks each fill up as the right one, and nobody's access outlives their turn (Vyre for Chrome in the profile fills nothing between turns).
const faceSent = new Set<string>();
// the steps that can set off a download report it (browserd waits for it to finish within a short bound), and the looks report what arrived after
const REPORTS_DOWNLOADS = new Set([
  "chrome_open",
  "chrome_click",
  "chrome_act",
  "chrome_type",
  "chrome_send",
  "chrome_wait",
  "chrome_state",
]);
const fillGrants = new Map<string, Slot>();
export async function grantFor(
  binding: NonNullable<ReturnType<typeof boundFill>>,
  profileId: string,
  agentId: string,
  asker: string,
): Promise<{ token: string; done(): void }> {
  const l = await turnLease(
    fillGrants,
    `${profileId}|${asker}`,
    async () => {
      const issued = await binding.issue({ computerId: profileId, agentId, asker, turn: true, ttlMs: TOKEN_TTL_MS });
      return { token: issued.fillToken, revoke: issued.revoke, ...(issued.extend ? { extend: issued.extend } : {}) };
    },
    { throwErrors: true },
  );
  return l!;
}

/** One tool in the agent's profile of the Space browser. What comes back is scrubbed of the Vault values filled for this profile; no desktop frame exists, so there is no timeline step (the live view shows the page). */
/**
 * A browser that is waking (its container and Chrome starting) can fail a first call from inside Vyre in a way no later call does. That is the layer's to wait out, not the model's to retry: a call that fails
 * outside the browser's own answer (never a HostError, which has its words) is tried again after a short wait, up to `tries` times in all, so the model sees one answer. The bound is about 6 seconds of waiting;
 * a failure that outlasts it is reported in plain words.
 */
export async function coldStartRetry<T>(f: () => Promise<T>, tries = 3, waitMs = 3_000): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await f();
    } catch (e) {
      if (e instanceof HostError || n >= tries) throw e;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function browserCall(ctx: CompCtx, profileId: string, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  try {
    return await coldStartRetry(() => browserCallIn(ctx, profileId, spec, args));
  } catch (e) {
    // an error the browser's own steps named (a refusal with its words) goes on as it is; anything else (a crash in the room, the hold or the agent's details on the very first call of a cold browser) was
    // reported as internal.unexpected, "retryable", and the person's agent tried again (13 Nov, owner on rc.26). It is a plain "not available", with the step it was at, and the server's log keeps the cause.
    if (e instanceof HostError) throw e;
    ctx.log.warn("sbrowser: a browser tool failed outside the browser's own answer", {
      tool: spec.name,
      reason: e instanceof Error ? e.message.slice(0, 160) : "unknown",
    });
    raise(
      ctx,
      "provider.unavailable",
      "The browser is not available right now, and nothing was changed. Wait a few seconds and call it once more.",
      { reason: "browser_not_ready", tool: spec.name },
    );
  }
}

async function browserCallIn(ctx: CompCtx, profileId: string, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  const sb = spaceBrowser();
  if (!sb) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  // a person at the controls: the agent's tools wait here, before the call reaches the browser service, however that service is reached and after it restarts (the hold is the module's own)
  const readAt = Date.now();
  const hold = await currentHold(ctx, sb, profileId);
  if (hold && !DURING_HOLD.has(spec.name))
    refuse(ctx, new ToolError("paused", HELD_LINE, "profile_held"), profileId, { takeoverBy: hold.personId });
  const binding = boundFill();
  // every call carries the channel, not only the typing ones: Vyre for Chrome in the profile fills logins on its own when a page loads, and asks the Vault through it, as this call's person, during this call.
  // The grant is taken right before each send and dropped right after it, so no Vault authority is held while the call waits for room, and its life always starts from the moment it is used.
  const lease = binding
    ? async <T>(run: (fill: { url: string; token: string }) => Promise<T>): Promise<T> => {
        const grant = await grantFor(binding, profileId, ctx.principal.id, actorOf(ctx));
        try {
          return await run({ url: binding.url(), token: grant.token });
        } finally {
          grant.done();
        }
      }
    : undefined;
  return browserStep(ctx, sb, profileId, spec, args, lease, { hold: hold?.personId ?? null, readAt });
}

async function browserStep(
  ctx: CompCtx,
  sb: NonNullable<ReturnType<typeof spaceBrowser>>,
  profileId: string,
  spec: ToolSpec,
  args: ToolArgs,
  lease: (<T>(run: (fill: { url: string; token: string }) => Promise<T>) => Promise<T>) | undefined,
  h: { hold: string | null; readAt: number },
): Promise<ToolAnswer> {
  // a browser that would start needs room on the host first (a claim on a running one is the same ask); from here to its answer the call is in flight, so making room never closes this browser
  // an agent's own call refreshes its turn's protection (sbrowser/room.ts)
  if (ctx.principal.kind === "agent") callStarted(profileId, ctx.space, ctx.now());
  else callStarted(profileId);
  let raw!: ToolAnswer;
  let list!: TabLister;
  let given!: ReturnType<typeof givenCount>;
  let reopened = false;
  try {
    if (
      spec.name !== "chrome_status" &&
      spec.name !== "chrome_stop" &&
      spec.name !== "chrome_resume" &&
      spec.name !== "chrome_plan"
    )
      await needRoom(ctx, sb, profileId);
    // the agent's name rides every call (the service keeps it in memory); its face is drawn once and kept with the profile
    let agent: { name: string; faceSvg?: string } | undefined;
    const who = await agentInfo(ctx, ctx.principal.id);
    if (who) {
      agent = { name: who.name };
      if (!faceSent.has(profileId)) {
        const svg = await faceSvg(who.face);
        if (svg) agent.faceSvg = svg;
        faceSent.add(profileId);
      }
    }
    list = async () =>
      tabsIn(
        await sb.tool({
          profileId,
          tool: "chrome_tabs",
          args: { action: "list" },
          timeoutMs: DEFAULT_TOOL_MS,
          space: ctx.space,
        }),
      );
    if (spec.name === "chrome_screenshot" && !(await pictureAllowed(profileId, list, args["tabId"])))
      raise(ctx, "validation.bad_input", HOLDS_VALUE, { reason: "vault_value_on_page" });
    given = givenCount(profileId);
    // a step on refs says which start of the browser they came from: browserd refuses it, with the line, when the browser has started again since (its pages reloaded, the refs gone or moved)
    const from = spec.name !== "chrome_snapshot" && namesRef(args) ? refsStart(profileId) : undefined;
    const sendWith = (fill?: { url: string; token: string }): Promise<ToolAnswer> =>
      sb.tool({
        profileId,
        ...(agent ? { agent } : {}),
        tool: spec.name,
        args,
        timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS),
        space: ctx.space,
        hold: h.hold,
        ...(fill ? { fill } : {}),
        ...(from ? { refsFrom: from } : {}),
        ...(ACTS.has(spec.name) ? { seenFrom: lastSeenStart(profileId) } : {}),
      });
    const send = (): Promise<ToolAnswer> => (lease ? lease((f) => sendWith(f)) : sendWith());
    try {
      try {
        raw = await send();
      } catch (e) {
        // the browser service is full though this profile holds room (another Space filled it): wait for room like any start, then send once more (it was refused before it ran)
        if (!(e instanceof ToolError && e.reason === "browser_full")) throw e;
        await needRoom(ctx, sb, profileId, { force: true });
        raw = await send();
      }
    } catch (e) {
      // an act on a page the agent has not seen: refused with the line; the refusal is its notice (sbrowser/room.ts refusedAt)
      if (e instanceof ToolError && e.reason === "browser_reopened") {
        refusedAt(profileId, e.start);
        return refuse(ctx, e, profileId);
      }
      // browserd still holds a takeover the table no longer has (a give back that did not reach it): released only if it began before this call read the table, so a takeover made since stays; the
      // call was refused before it ran, so it is sent once more
      if (
        !(e instanceof ToolError && e.code === "paused" && /has the controls/i.test(e.message)) ||
        heldBy(ctx, profileId) !== null
      )
        return refuse(ctx, e, profileId);
      try {
        await sb.giveBack(profileId, { before: h.readAt });
        raw = await send();
      } catch (e2) {
        if (e2 instanceof ToolError && e2.code === "paused" && /has the controls/i.test(e2.message))
          return refuse(ctx, new ToolError("paused", HELD_LINE, "profile_held"), profileId);
        return refuse(ctx, e2, profileId);
      }
    }
  } finally {
    callEnded(profileId);
  }
  if (!isRecord(raw)) raise(ctx, "provider.unavailable", "The browser answered with something that is not an object.");
  const { used, frame: _frame, caption: _caption, browserStart, ...rest } = raw;
  // which start of the browser answered: a different one than last time means it was reopened (closed to make room, or stopped when idle) and its pages reloaded. The agent's answer says so once
  const start = typeof browserStart === "string" ? browserStart : "";
  reopened = answerFrom(profileId, start);
  if (spec.name === "chrome_snapshot") snapshotFrom(profileId, start);
  rememberSecrets(profileId, secretsOf(used), { handedOut: false });
  for (const x of secretsOf(used)) noteCallSecret(ctx.trace.traceId, x.value); // an error later in this call is logged without them
  // the tab a value went into, by a tool or by Vyre for Chrome while this call ran, is never pictured while it is open
  await markAfter(
    profileId,
    list,
    given,
    args["tabId"] ?? (spec.name === "chrome_open" ? rest["tabId"] : undefined),
    secretsOf(used).map((x) => x.value),
  ).catch((e: unknown) => {
    // the page is already open: a failure to note which tab a value went into is the server's to log, never the agent's to retry
    ctx.log.warn("sbrowser: could not note the tab after a call", {
      tool: spec.name,
      reason: e instanceof Error ? e.message.slice(0, 160) : "unknown",
    });
  });
  if (spec.name === "chrome_tabs" && tabsIn(rest).length > 0)
    tabsOpen(
      profileId,
      tabsIn(rest).map((t) => t.tabId),
    );
  const out = scrubDeep(profileId, rest) as ToolAnswer;
  if (reopened) {
    out["reopened"] = true;
    out["note"] = REOPENED_LINE;
  }
  // what the browser finished downloading goes into the agent's Files (Downloads) and the agent is told where; only the steps that say so carry it
  // a step with a caption is one line of the agent's browser timeline, with a picture of the page, and the chat shows the browser live once per burst of work
  if (spec.caption) {
    const at = ctx.now();
    let words = clean(profileId, spec.caption(args, out).trim()).slice(0, 200);
    // the person watching reads the same as the agent: the browser was reopened and its pages reloaded
    if (reopened) words = `${words} · Browser reopened, pages reloaded`;
    let frame: string | undefined;
    // no picture of a page that holds a value filled from the Vault (it is kept in Files, and a text field shows its value); the step says so in one line, and so whether the chat's live card,
    // which needs that picture, was due and not posted
    if (await pictureAllowed(profileId, list, undefined)) {
      try {
        const shot = await sb.screenshot(profileId);
        frame = Buffer.from(shot.bytes).toString("base64");
      } catch {
        /* a step without a picture */
      }
    } else words = `${words} · ${cardDue(ctx, ctx.principal.id, at) ? NO_PICTURE_OR_CARD : NO_PICTURE}`;
    const c = { computerId: profileId, agentId: ctx.principal.id } as unknown as ComputerRow;
    const frameFileId = await keepFrame(ctx, c, frame, at);
    addStep(ctx.db, profileId, at, {
      by: "agent",
      caption: words,
      tool: spec.name,
      ...(frameFileId ? { frameFileId } : {}),
      ...(ctx.run ? { runId: ctx.run } : {}),
      ...(ctx.thread ? { threadId: ctx.thread } : {}),
    });
    await browserCard(ctx, ctx.principal.id, words, frameFileId, at);
  }
  if (REPORTS_DOWNLOADS.has(spec.name)) {
    const saved = await takeDownloads(ctx, sb, profileId, ctx.principal.id);
    if (saved.length > 0) out["downloads"] = saved;
  }
  return out;
}

/** One tool in the person's own Chrome. What comes back is what the extension answered (it already hides secret fields and never holds a value); a held send or post also leaves its card in the chat. */
async function personalCall(ctx: CompCtx, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  const port = personalChrome() as PersonalChrome;
  let raw: ToolAnswer;
  try {
    raw = await port.call({
      tool: spec.name,
      args,
      agent: { id: ctx.principal.id, name: ctx.principal.id },
      space: ctx.space,
      ...(ctx.thread ? { thread: ctx.thread } : {}),
      timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS),
    });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    const message = e instanceof Error ? e.message : "Your Chrome did not answer.";
    raise(ctx, code === "offline" || code === "timeout" ? "provider.unavailable" : "validation.bad_input", message);
  }
  if (!isRecord(raw)) raise(ctx, "provider.unavailable", "Your Chrome answered with something that is not an object.");
  const out: ToolAnswer = { ...raw };
  // the extension names a screenshot `image`; the capability's answer is `png`
  if (spec.name === "chrome_screenshot" && typeof out["image"] === "string" && out["png"] === undefined) {
    out["png"] = out["image"];
    delete out["image"];
  }
  if (ctx.thread) await chromeCards(ctx, port, out);
  return out;
}

const lastStep = new Map<string, number>();
/** The chat's two cards for work in the person's Chrome: "Using your Chrome" once per burst, and a held item as soon as there is one. Posting never fails the tool call. */
async function chromeCards(ctx: CompCtx, port: PersonalChrome, out: ToolAnswer): Promise<void> {
  const thread = ctx.thread as string;
  const agent = ctx.principal.id;
  const at = ctx.now();
  try {
    const heldId = typeof out["heldId"] === "string" ? out["heldId"] : "";
    const held = heldId ? await port.held(heldId) : null;
    if (heldId && held) {
      await ctx.call("browser.cards.post", {
        threadId: thread,
        idempotencyKey: `chrheld:${heldId}`,
        block: {
          type: "chrome_held",
          data: {
            heldId,
            agentId: agent,
            site: held.site ?? "",
            kind: held.kind ?? "send",
            summary: held.summary ?? "",
            card: held.card ?? {},
            state: "waiting",
          },
        },
      });
    }
    if (heldId && held) {
      // the step block above the held card: what the agent did, then what waits for the person
      const plan = port.plan(agent);
      const frameNow = port.frame(agent);
      if (plan && plan.steps.length > 0) {
        const steps = plan.steps.map((text, i) => ({ text, state: i < plan.done ? "done" : "todo" }));
        steps.push({
          text: `${held.kind === "post" ? "Post" : held.kind === "payment" ? "Payment" : held.kind === "delete" ? "Delete" : "Send"} waits for you`,
          state: "waiting",
        });
        await ctx.call("browser.cards.post", {
          threadId: thread,
          idempotencyKey: `chrplan:${heldId}`,
          block: {
            type: "chrome_step",
            data: {
              agentId: agent,
              site: held.site || frameNow?.site || "your Chrome",
              thumb: frameNow?.thumb ?? null,
              state: "waiting",
              goal: plan.goal,
              steps,
            },
          },
        });
      }
    }
    const f = port.frame(agent);
    const key = `${agent}|${thread}`;
    const prev = lastStep.get(key);
    if (f && (prev === undefined || at - prev >= LIVE_GAP_MS)) {
      lastStep.set(key, at);
      await ctx.call("browser.cards.post", {
        threadId: thread,
        idempotencyKey: `chrstep:${agent}:${thread}:${Math.floor(at / LIVE_GAP_MS)}`,
        block: { type: "chrome_step", data: { agentId: agent, site: f.site, thumb: f.thumb, state: "using" } },
      });
    }
  } catch {
    /* the work went through; the card is a courtesy */
  }
}

/** The whole path for a tool with nothing special: prepare, call. */
export async function run(
  ctx: CompCtx,
  input: { computerId?: string | undefined; inMyChrome?: boolean | undefined },
  spec: ToolSpec,
  args: ToolArgs,
): Promise<ToolAnswer> {
  const r = await prepare(ctx, whereOf(input), spec);
  if (!r) return spec.asleep ?? {};
  return call(ctx, r, spec, args);
}

/** The defined fields of an object: `undefined` is not sent to agentd. */
export function defined(o: Record<string, unknown>): ToolArgs {
  const out: ToolArgs = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** A short host for a caption: the site of a URL, else the text cut to length. */
export function siteOf(url: unknown): string {
  if (typeof url !== "string") return "a page";
  try {
    return new URL(url).host || url.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}
/** A page for a caption: its host and path (no query), so two steps on one site name different pages ("Opened harborquotes.com/pricing"). */
export function pageOf(url: unknown): string {
  if (typeof url !== "string") return "a page";
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return clip(`${u.host}${path}`, 80) || url.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}
export const clip = (v: unknown, n = 50): string => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

// ---- shape of an answer ----------------------------------------------------------------------------------------------------------------------------------

/** s string, n number, b boolean, a array, o object, j anything; a trailing ? makes the key optional. */
export type Shape = Record<string, "s" | "n" | "b" | "a" | "o" | "j" | "s?" | "n?" | "b?" | "a?" | "o?" | "j?">;

const KIND: Record<string, (v: unknown) => boolean> = {
  s: (v) => typeof v === "string",
  n: (v) => typeof v === "number" && Number.isFinite(v),
  b: (v) => typeof v === "boolean",
  a: Array.isArray,
  o: isRecord,
  j: () => true,
};

/** The answer cut down to the keys of the capability's output, each of the right type. An agentd that answers with something else is a provider fault, not a result to hand to the model. */
export function shape(ctx: CompCtx, tool: string, out: ToolAnswer, want: Shape): ToolAnswer {
  const res: ToolAnswer = {};
  for (const [key, kind] of Object.entries(want)) {
    const optional = kind.endsWith("?");
    const check = KIND[kind.replace("?", "")] as (v: unknown) => boolean;
    const v = out[key];
    if (v === undefined || v === null) {
      if (kind === "j") {
        res[key] = null;
        continue;
      }
      if (optional || kind === "j?") continue;
      raise(ctx, "provider.unavailable", `The computer's ${tool} answer has no ${key}.`);
    }
    if (!check(v)) raise(ctx, "provider.unavailable", `The computer's ${tool} answer has the wrong kind of ${key}.`);
    res[key] = v;
  }
  // the first answer after the browser was reopened says so, whatever the tool (browserStep)
  if (out["reopened"] === true) {
    res["reopened"] = true;
    if (typeof out["note"] === "string") res["note"] = out["note"];
  }
  return res;
}

// ---- a picture kept in the agent's folder ------------------------------------------------------------------------------------------------------------

/** Store a screenshot agentd returned (base64 PNG) in the agent's Files folder and answer as the screenshot capabilities do. */
export async function keepShot(
  ctx: CompCtx,
  c: ComputerRow,
  tool: string,
  out: ToolAnswer,
  o: { fit?: boolean } = {},
): Promise<{
  fileId: string;
  width: number;
  height: number;
  pageWidth?: number;
  pageHeight?: number;
  scale?: number;
  note?: string;
}> {
  const got = shape(ctx, tool, out, { png: "s", width: "n", height: "n" });
  const folderId = await agentFolder(ctx, c.agentId);
  if (!folderId) raise(ctx, "validation.bad_input", "The agent has no folder to keep the picture in.");
  // A picture over the size limit for a direct write to Files is scaled down to fit and the agent is told the size it got (13 Nov: a heavy page's screenshot failed with validation.too_large). The desktop's
  // own screenshot is not scaled: its clicks are in the desktop's pixels.
  let png = String(got["png"]);
  let [width, height] = [Number(got["width"]), Number(got["height"])];
  let note: string | undefined;
  let page: { pageWidth: number; pageHeight: number; scale: number } | undefined;
  if (o.fit !== false) {
    const fit = await fitPngOffLoop(png, { width, height });
    if (!fit.ok) raise(ctx, "validation.bad_input", fit.why);
    ({ base64: png, width, height } = fit.shot);
    // only a picture that is not the page as it is carries the page's size and the scale
    if (fit.shot.scale !== 1 || fit.shot.topPx !== undefined) {
      page = { pageWidth: fit.shot.pageWidth, pageHeight: fit.shot.pageHeight, scale: fit.shot.scale };
      note = scaledNote(fit.shot);
    }
  }
  const at = ctx.now();
  const made = (await ctx.call("files.create", {
    folderId,
    name: `screenshot-${new Date(at).toISOString().replace(/[:.]/g, "-")}.png`,
    kind: "image",
    mime: "image/png",
    content: { base64: png },
    idempotencyKey: `cmpshot:${c.computerId}:${mintId("shot", at)}`,
  })) as { file: { fileId: string } };
  setComputer(ctx.db, c.computerId, { last_frame_at: at, last_frame_file: made.file.fileId });
  return { fileId: made.file.fileId, width, height, ...(page ?? {}), ...(note ? { note } : {}) };
}
