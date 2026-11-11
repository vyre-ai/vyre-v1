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
import { actorOf, addStep, agentFolder, boundFill, clean, hostFor, ensure, mintId, needComputer, needTeam, raise, rememberSecrets, rowsOf, setComputer } from "../../projections.ts";
import { personalChrome } from "../../projections.ts";
import type { CompCtx, ComputerHost, ComputerRow, PersonalChrome, Secret } from "../../projections.ts";
import { awaken } from "../lifecycle.ts";
import { askedThisTurn } from "./my-chrome-ask.ts";
import { spaceBrowser } from "../../sbrowser/port.ts";
import { profileIdOf } from "../../sbrowser/policy.ts";
import { takeDownloads } from "../../sbrowser/downloads.ts";
import { needRoom } from "../../sbrowser/room.ts";
import { currentHold, DURING_HOLD, HELD_LINE } from "../../sbrowser/hold.ts";
import { agentInfo } from "../../sbrowser/agentinfo.ts";
import { faceSvg } from "../../sbrowser/face.ts";
import { waitingNote } from "../../capacity.ts";

export type ToolArgs = Record<string, unknown>;
export type ToolAnswer = Record<string, unknown>;

/** The code agentd gave for a refusal. */
export type ToolCode = "timeout" | "paused" | "not_found" | "bad_input" | "held" | "unavailable";

export class ToolError extends Error {
  readonly code: ToolCode;
  constructor(code: ToolCode, message: string) { super(message); this.name = "ToolError"; this.code = code; }
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
  if (typeof host.tool !== "function") raise(ctx, "provider.unavailable", "This host cannot run tools on an agent computer.");
  return host as ComputerHost & ToolHost;
}

/** The computer a tool call is for: the one named, else the caller's own (an agent has one). */
export function computerFor(ctx: CompCtx, computerId: string | undefined): ComputerRow {
  if (computerId) return needComputer(ctx, computerId);
  if (ctx.principal.kind !== "agent") raise(ctx, "validation.bad_input", "Say which computer. Only an agent can leave it out.");
  const r = rowsOf(ctx.db, "SELECT computer_id FROM computers_computers WHERE agent_id = ?", ctx.principal.id)[0];
  if (!r) raise(ctx, "validation.not_found", "This agent has no computer. Give it one first.", { agentId: ctx.principal.id });
  return needComputer(ctx, String(r["computer_id"]));
}

function mayUse(ctx: CompCtx, c: ComputerRow): void {
  if (ctx.principal.kind === "agent" && ctx.principal.id === c.agentId) return;
  if (ctx.authorize({ perm: "computers.use", level: "use" }, { type: "computer", id: c.computerId }).effect !== "allow") raise(ctx, "permission.no_grant", "You cannot use this agent's computer.");
}

const CODES = {
  timeout: "timeout.deadline", paused: "provider.unavailable", not_found: "validation.not_found", bad_input: "validation.bad_input", held: "validation.bad_input", unavailable: "provider.unavailable",
} as const;

function refuse(ctx: CompCtx, e: unknown): never {
  if (e instanceof ToolError) {
    // "paused" is two things: the person pressed Esc (the Chrome extension), or a person has taken over the browser and holds the controls (the Space browser says so in its own words, and those are the true reason)
    const text = e.code === "paused" && !/has the controls/i.test(e.message) ? "Chrome is paused. The person pressed Esc; wait for their answer, then resume." : e.message.slice(0, 300);
    raise(ctx, CODES[e.code], text, { agentd: e.code });
  }
  raise(ctx, "provider.unavailable", "The computer did not answer the tool.", { reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
    if (isRecord(x) && typeof x["handle"] === "string" && typeof x["itemId"] === "string" && typeof x["value"] === "string" && x["value"].length >= 4) out.push({ handle: x["handle"], itemId: x["itemId"], value: x["value"] });
  }
  return out;
}

async function keepFrame(ctx: CompCtx, c: ComputerRow, frame: unknown, at: number): Promise<string | undefined> {
  if (typeof frame !== "string" || frame === "") return undefined;
  try {
    const folderId = await agentFolder(ctx, c.agentId);
    if (!folderId) return undefined;
    const made = (await ctx.call("files.create", {
      folderId, name: `step-${new Date(at).toISOString().replace(/[:.]/g, "-")}.png`, kind: "image", mime: "image/png", content: { base64: frame }, idempotencyKey: `cmpstep:${c.computerId}:${mintId("stp", at)}`,
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
async function liveCard(ctx: CompCtx, c: ComputerRow, caption: string, fileId: string | undefined, at: number): Promise<void> {
  if (!ctx.thread || ctx.principal.kind !== "agent" || !fileId) return;
  const key = `${c.computerId}|${ctx.thread}`;
  const prev = lastCard.get(key);
  lastCard.set(key, at);
  if (prev !== undefined && at - prev < LIVE_GAP_MS) return;
  try {
    await ctx.call("chat.post", {
      threadId: ctx.thread, body: "", mentions: [], idempotencyKey: `cmplive:${c.computerId}:${ctx.thread}:${Math.floor(at / LIVE_GAP_MS)}`,
      blocks: [{ type: "screenshot", v: 1, data: { computerId: c.computerId, fileId, caption, at, live: true } }],
    });
  } catch { lastCard.delete(key); }
}

// Is the Space browser usable on this host (the container runtime answers)? Asked at most every 15 seconds. When it is not, an agent keeps browsing where it did before.
let usable: { sb: unknown; at: number; ok: boolean } | null = null;
async function browserUsable(sb: NonNullable<ReturnType<typeof spaceBrowser>>, now: number): Promise<boolean> {
  if (usable && usable.sb === sb && now - usable.at < 15_000) return usable.ok;
  const ok = await sb.available().catch(() => false);
  usable = { sb, at: now, ok };
  return ok;
}

/** The chat's live card for work in an agent's Space browser: one per burst of ten quiet minutes. Posting never fails the tool call. */
async function browserCard(ctx: CompCtx, agentId: string, caption: string, fileId: string | undefined, at: number): Promise<void> {
  if (!ctx.thread || ctx.principal.kind !== "agent" || !fileId) return;
  const key = `browser|${agentId}|${ctx.thread}`;
  const prev = lastCard.get(key);
  lastCard.set(key, at);
  if (prev !== undefined && at - prev < LIVE_GAP_MS) return;
  try {
    await ctx.call("chat.post", { threadId: ctx.thread, body: "", mentions: [], idempotencyKey: `sbrlive:${agentId}:${ctx.thread}:${Math.floor(at / LIVE_GAP_MS)}`, blocks: [{ type: "browser_screenshot", v: 1, data: { agentId, fileId, caption, at, live: true } }] });
  } catch { lastCard.delete(key); }
}

export interface Resolved {
  computer: ComputerRow; host: ComputerHost & ToolHost;
  /** The person's own Chrome, not an agent computer. */ personal?: boolean;
  /** The agent's profile in the Space browser (sbrowser/): a Chrome of its own on the Space host, no computer needed. */ browser?: { profileId: string };
}

/** Name this as `computerId` to work in the person's own Chrome. An agent with no computer of its own gets it without naming it, when the person has opened their Chrome to agents. */
export const MY_CHROME = "my-chrome";

const stub = (ctx: CompCtx): ComputerRow => ({ computerId: MY_CHROME, agentId: ctx.principal.id, state: "working" } as unknown as ComputerRow);

/** Tools that never need the ask of this turn: they finish or stop what an ask already began (a held item waiting for the person, Stop, Resume, and the look at whether Chrome is connected). */
const NO_ASK = new Set(["chrome_send", "chrome_stop", "chrome_resume", "chrome_status"]);

/** Where a call goes: `inMyChrome: true` is the way to ask for the person's Chrome; the older spelling `computerId: "my-chrome"` means the same. */
export const whereOf = (input: { computerId?: string | undefined; inMyChrome?: boolean | undefined }): string | undefined => (input.inMyChrome === true ? MY_CHROME : input.computerId);

const NOT_ASKED = "The person did not ask for their own Chrome in this turn, so it is not used. Work in the Space browser. If their own Chrome is what the task needs, ask them with ask_question: Use my Chrome, or Use the Space browser.";
const NOT_CONNECTED = "Your Chrome is not connected: Vyre for Chrome is not open on your computer, or it is not turned on for agents in this Space. I can do this in the Space browser instead. Tell the person that plainly and offer it.";

/** Is this call for the person's Chrome? Only when the call asks for it (`inMyChrome`), the person asked for it in this turn, and the Chrome is the one of the person the agent works for and is open to agents. Never by default. */
async function wantsMyChrome(ctx: CompCtx, computerId: string | undefined, tool?: string): Promise<boolean> {
  const asked = computerId === MY_CHROME;
  if (!asked) return false;
  if (ctx.principal.kind !== "agent") raise(ctx, "validation.bad_input", "Your Chrome is for an agent working for you. Say which agent computer you mean.");
  const person = ctx.actingFor;
  if (!person) raise(ctx, "validation.bad_input", "Your Chrome is the Chrome of the person you work for, and this work is not for anyone.");
  if (!(tool && NO_ASK.has(tool)) && !(await askedThisTurn(ctx))) raise(ctx, "validation.bad_input", NOT_ASKED, { reason: "not_asked" });
  const port = personalChrome();
  if (!port || !(await port.available({ space: ctx.space, person }))) raise(ctx, "provider.unavailable", NOT_CONNECTED, { reason: "not_connected" });
  return true;
}

/** Everything before the call: team Space, the computer, the caller's right to it, awake, and the controls with the agent. Returns null when the spec says to leave a sleeping computer alone. */
export async function prepare(ctx: CompCtx, computerId: string | undefined, spec: Pick<ToolSpec, "noWake" | "duringTakeover"> & { name?: string }): Promise<Resolved | null> {
  ensure(ctx.db);
  needTeam(ctx);
  // The person's own Chrome, when they asked for it this turn, comes before the Space browser.
  if (await wantsMyChrome(ctx, computerId, spec.name)) return { computer: stub(ctx), host: {} as ComputerHost & ToolHost, personal: true };
  // The Space browser is where an agent browses by default (owner decision 6 Nov): its own profile, on the Space host, whoever asked, so the person's computer is never disturbed and a team agent's logins
  // outlive the person who asked. Only a call that names a computer (a person working one) or the person's own Chrome (`my-chrome`, on request) goes elsewhere.
  if (spec.name !== undefined && spec.name.startsWith("chrome_") && computerId === undefined && ctx.principal.kind === "agent" && spaceBrowser() && await browserUsable(spaceBrowser()!, ctx.now())) {
    const profileId = profileIdOf(ctx.principal.id);
    if (!profileId) raise(ctx, "validation.bad_input", "This agent cannot have a browser profile: its id is not valid.");
    return { computer: { computerId: profileId, agentId: ctx.principal.id, state: "working" } as unknown as ComputerRow, host: {} as ComputerHost & ToolHost, browser: { profileId } };
  }
  let c = computerFor(ctx, computerId);
  mayUse(ctx, c);
  // The controls are the person's: the tools wait for an agent, never for the person at the controls (their own click or key through the live view is a tool call as them).
  const atTheControls = ctx.principal.kind === "person" && c.takeoverBy !== undefined && actorOf(ctx) === c.takeoverBy;
  if (c.state === "takeover" && !spec.duringTakeover && !atTheControls) raise(ctx, "validation.bad_input", "A person has the controls. The tools wait until they give them back.", { takeoverBy: c.takeoverBy });
  if (c.state === "asleep" && spec.noWake) return null;
  if (c.state === "asleep" || c.state === "error") c = await awaken(ctx, c, actorOf(ctx));
  if (c.state === "provisioning" || c.state === "waking") raise(ctx, "provider.unavailable", waitingNote(ctx.db, c.computerId) ?? "This computer is still starting.");
  return { computer: c, host: toolHost(ctx, c.computerId) };
}

/** One call to agentd and everything after it: scrub, remember what was filled, keep the frame, add the step. Returns the capability's output. */
export async function call(ctx: CompCtx, r: Resolved, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  if (r.personal) return personalCall(ctx, spec, args);
  if (r.browser) return browserCall(ctx, r.browser.profileId, spec, args);
  const c = r.computer;
  let raw: ToolAnswer;
  try {
    const byPerson = c.state === "takeover" && ctx.principal.kind === "person" && c.takeoverBy !== undefined && actorOf(ctx) === c.takeoverBy;
    raw = await r.host.tool({ computerId: c.computerId, tool: spec.name, args, timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS), ...(byPerson ? { by: "person" as const } : {}) });
  } catch (e) {
    return refuse(ctx, e);
  }
  if (!isRecord(raw)) raise(ctx, "provider.unavailable", "The computer answered with something that is not an object.");
  const { used, frame, caption, ...rest } = raw;
  rememberSecrets(c.computerId, secretsOf(used));
  const out = scrubDeep(c.computerId, rest) as ToolAnswer;
  const at = ctx.now();
  setComputer(ctx.db, c.computerId, { last_active_at: at });
  if (spec.caption) {
    const words = typeof caption === "string" && caption.trim() !== "" ? clean(c.computerId, caption.trim()).slice(0, 200) : spec.caption(args, out);
    const frameFileId = await keepFrame(ctx, c, frame, at);
    addStep(ctx.db, c.computerId, at, {
      by: ctx.principal.kind === "agent" ? "agent" : "person", caption: words, tool: spec.name, ...(frameFileId ? { frameFileId } : {}), ...(ctx.run ? { runId: ctx.run } : {}), ...(ctx.thread ? { threadId: ctx.thread } : {}),
    });
    await liveCard(ctx, c, words, frameFileId, at);
  }
  return out;
}

// The Vault channel of an agent's profile: one token per profile and asker, so the Vault logs who asked and a use after the asker changes is checked as the new asker.
const faceSent = new Set<string>();
// the steps that can set off a download report it (browserd waits for it to finish within a short bound), and the looks report what arrived after
const REPORTS_DOWNLOADS = new Set(["chrome_open", "chrome_click", "chrome_act", "chrome_type", "chrome_send", "chrome_wait", "chrome_state"]);
const fillGrants = new Map<string, { token: string; revoke(): void }>();

/** One tool in the agent's profile of the Space browser. What comes back is scrubbed of the Vault values filled for this profile; no desktop frame exists, so there is no timeline step (the live view shows the page). */
async function browserCall(ctx: CompCtx, profileId: string, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  const sb = spaceBrowser();
  if (!sb) raise(ctx, "provider.unavailable", "The Space browser is not running on this host.");
  // a person at the controls: the agent's tools wait here, before the call reaches the browser service, however that service is reached and after it restarts (the hold is the module's own)
  if (!DURING_HOLD.has(spec.name)) {
    const h = await currentHold(ctx, sb, profileId);
    if (h) raise(ctx, "provider.unavailable", HELD_LINE, { takeoverBy: h.personId });
  }
  let fill: { url: string; token: string } | undefined;
  const binding = boundFill();
  // every call carries the channel, not only the typing ones: Vyre for Chrome in the profile fills logins on its own when a page loads, and asks the Vault through it
  if (binding) {
    const asker = actorOf(ctx);
    const key = `${profileId}|${asker}`;
    let g = fillGrants.get(key);
    if (!g) {
      for (const [k, old] of fillGrants) if (k.startsWith(`${profileId}|`)) { old.revoke(); fillGrants.delete(k); }
      const issued = await binding.issue({ computerId: profileId, agentId: ctx.principal.id, asker });
      g = { token: issued.fillToken, revoke: issued.revoke };
      fillGrants.set(key, g);
    }
    fill = { url: binding.url(), token: g.token };
  }
  // a browser that would start needs room on the host first (a claim on a running one is the same ask)
  if (spec.name !== "chrome_status" && spec.name !== "chrome_stop" && spec.name !== "chrome_resume" && spec.name !== "chrome_plan") await needRoom(ctx, sb, profileId);
  // the agent's name rides every call (the service keeps it in memory); its face is drawn once and kept with the profile
  let agent: { name: string; faceSvg?: string } | undefined;
  const who = await agentInfo(ctx, ctx.principal.id);
  if (who) {
    agent = { name: who.name };
    if (!faceSent.has(profileId)) { const svg = await faceSvg(who.face); if (svg) agent.faceSvg = svg; faceSent.add(profileId); }
  }
  let raw: ToolAnswer;
  try {
    raw = await sb.tool({ profileId, ...(agent ? { agent } : {}), tool: spec.name, args, timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS), space: ctx.space, ...(fill ? { fill } : {}) });
  } catch (e) {
    return refuse(ctx, e);
  }
  if (!isRecord(raw)) raise(ctx, "provider.unavailable", "The browser answered with something that is not an object.");
  const { used, frame: _frame, caption: _caption, ...rest } = raw;
  rememberSecrets(profileId, secretsOf(used));
  const out = scrubDeep(profileId, rest) as ToolAnswer;
  // what the browser finished downloading goes into the agent's Files (Downloads) and the agent is told where; only the steps that say so carry it
  // a step with a caption is one line of the agent's browser timeline, with a picture of the page, and the chat shows the browser live once per burst of work
  if (spec.caption) {
    const at = ctx.now();
    const words = clean(profileId, spec.caption(args, out).trim()).slice(0, 200);
    let frame: string | undefined;
    try { const shot = await sb.screenshot(profileId); frame = Buffer.from(shot.bytes).toString("base64"); } catch { /* a step without a picture */ }
    const c = { computerId: profileId, agentId: ctx.principal.id } as unknown as ComputerRow;
    const frameFileId = await keepFrame(ctx, c, frame, at);
    addStep(ctx.db, profileId, at, { by: "agent", caption: words, tool: spec.name, ...(frameFileId ? { frameFileId } : {}), ...(ctx.run ? { runId: ctx.run } : {}), ...(ctx.thread ? { threadId: ctx.thread } : {}) });
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
    raw = await port.call({ tool: spec.name, args, agent: { id: ctx.principal.id, name: ctx.principal.id }, space: ctx.space, ...(ctx.thread ? { thread: ctx.thread } : {}), timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS) });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    const message = e instanceof Error ? e.message : "Your Chrome did not answer.";
    raise(ctx, code === "offline" || code === "timeout" ? "provider.unavailable" : "validation.bad_input", message);
  }
  if (!isRecord(raw)) raise(ctx, "provider.unavailable", "Your Chrome answered with something that is not an object.");
  const out: ToolAnswer = { ...raw };
  // the extension names a screenshot `image`; the capability's answer is `png`
  if (spec.name === "chrome_screenshot" && typeof out["image"] === "string" && out["png"] === undefined) { out["png"] = out["image"]; delete out["image"]; }
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
      await ctx.call("browser.cards.post", { threadId: thread, idempotencyKey: `chrheld:${heldId}`, block: { type: "chrome_held", data: { heldId, agentId: agent, site: held.site ?? "", kind: held.kind ?? "send", summary: held.summary ?? "", card: held.card ?? {}, state: "waiting" } } });
    }
    if (heldId && held) {
      // the step block above the held card: what the agent did, then what waits for the person
      const plan = port.plan(agent);
      const frameNow = port.frame(agent);
      if (plan && plan.steps.length > 0) {
        const steps = plan.steps.map((text, i) => ({ text, state: i < plan.done ? "done" : "todo" }));
        steps.push({ text: `${held.kind === "post" ? "Post" : held.kind === "payment" ? "Payment" : held.kind === "delete" ? "Delete" : "Send"} waits for you`, state: "waiting" });
        await ctx.call("browser.cards.post", { threadId: thread, idempotencyKey: `chrplan:${heldId}`, block: { type: "chrome_step", data: { agentId: agent, site: held.site || frameNow?.site || "your Chrome", thumb: frameNow?.thumb ?? null, state: "waiting", goal: plan.goal, steps } } });
      }
    }
    const f = port.frame(agent);
    const key = `${agent}|${thread}`;
    const prev = lastStep.get(key);
    if (f && (prev === undefined || at - prev >= LIVE_GAP_MS)) {
      lastStep.set(key, at);
      await ctx.call("browser.cards.post", { threadId: thread, idempotencyKey: `chrstep:${agent}:${thread}:${Math.floor(at / LIVE_GAP_MS)}`, block: { type: "chrome_step", data: { agentId: agent, site: f.site, thumb: f.thumb, state: "using" } } });
    }
  } catch { /* the work went through; the card is a courtesy */ }
}

/** The whole path for a tool with nothing special: prepare, call. */
export async function run(ctx: CompCtx, input: { computerId?: string | undefined; inMyChrome?: boolean | undefined }, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
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
  try { return new URL(url).host || url.slice(0, 60); } catch { return url.slice(0, 60); }
}
export const clip = (v: unknown, n = 50): string => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// ---- shape of an answer ----------------------------------------------------------------------------------------------------------------------------------

/** s string, n number, b boolean, a array, o object, j anything; a trailing ? makes the key optional. */
export type Shape = Record<string, "s" | "n" | "b" | "a" | "o" | "j" | "s?" | "n?" | "b?" | "a?" | "o?" | "j?">;

const KIND: Record<string, (v: unknown) => boolean> = {
  s: (v) => typeof v === "string", n: (v) => typeof v === "number" && Number.isFinite(v), b: (v) => typeof v === "boolean", a: Array.isArray, o: isRecord, j: () => true,
};

/** The answer cut down to the keys of the capability's output, each of the right type. An agentd that answers with something else is a provider fault, not a result to hand to the model. */
export function shape(ctx: CompCtx, tool: string, out: ToolAnswer, want: Shape): ToolAnswer {
  const res: ToolAnswer = {};
  for (const [key, kind] of Object.entries(want)) {
    const optional = kind.endsWith("?");
    const check = KIND[kind.replace("?", "")] as (v: unknown) => boolean;
    const v = out[key];
    if (v === undefined || v === null) {
      if (kind === "j") { res[key] = null; continue; }
      if (optional || kind === "j?") continue;
      raise(ctx, "provider.unavailable", `The computer's ${tool} answer has no ${key}.`);
    }
    if (!check(v)) raise(ctx, "provider.unavailable", `The computer's ${tool} answer has the wrong kind of ${key}.`);
    res[key] = v;
  }
  return res;
}

// ---- a picture kept in the agent's folder ------------------------------------------------------------------------------------------------------------

/** Store a screenshot agentd returned (base64 PNG) in the agent's Files folder and answer as the screenshot capabilities do. */
export async function keepShot(ctx: CompCtx, c: ComputerRow, tool: string, out: ToolAnswer): Promise<{ fileId: string; width: number; height: number }> {
  const got = shape(ctx, tool, out, { png: "s", width: "n", height: "n" });
  const folderId = await agentFolder(ctx, c.agentId);
  if (!folderId) raise(ctx, "validation.bad_input", "The agent has no folder to keep the picture in.");
  const at = ctx.now();
  const made = (await ctx.call("files.create", {
    folderId, name: `screenshot-${new Date(at).toISOString().replace(/[:.]/g, "-")}.png`, kind: "image", mime: "image/png", content: { base64: got["png"] }, idempotencyKey: `cmpshot:${c.computerId}:${mintId("shot", at)}`,
  })) as { file: { fileId: string } };
  setComputer(ctx.db, c.computerId, { last_frame_at: at, last_frame_file: made.file.fileId });
  return { fileId: made.file.fileId, width: Number(got["width"]), height: Number(got["height"]) };
}
