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
import { actorOf, addStep, agentFolder, boundHost, clean, ensure, mintId, needComputer, needTeam, raise, rememberSecrets, rowsOf, setComputer } from "../../projections.ts";
import type { CompCtx, ComputerHost, ComputerRow, Secret } from "../../projections.ts";
import { awaken } from "../lifecycle.ts";

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
  tool(a: { computerId: string; tool: string; args: ToolArgs; timeoutMs: number }): Promise<ToolAnswer>;
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

function toolHost(ctx: CompCtx): ComputerHost & ToolHost {
  const host = boundHost() as (ComputerHost & Partial<ToolHost>) | null;
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
    const text = e.code === "paused" ? "Chrome is paused. The person pressed Esc; wait for their answer, then resume." : e.message.slice(0, 300);
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

export interface Resolved { computer: ComputerRow; host: ComputerHost & ToolHost }

/** Everything before the call: team Space, the computer, the caller's right to it, awake, and the controls with the agent. Returns null when the spec says to leave a sleeping computer alone. */
export async function prepare(ctx: CompCtx, computerId: string | undefined, spec: Pick<ToolSpec, "noWake" | "duringTakeover">): Promise<Resolved | null> {
  ensure(ctx.db);
  needTeam(ctx);
  let c = computerFor(ctx, computerId);
  mayUse(ctx, c);
  if (c.state === "takeover" && !spec.duringTakeover) raise(ctx, "validation.bad_input", "A person has the controls. The tools wait until they give them back.", { takeoverBy: c.takeoverBy });
  if (c.state === "asleep" && spec.noWake) return null;
  if (c.state === "asleep" || c.state === "error") c = await awaken(ctx, c, actorOf(ctx));
  if (c.state === "provisioning" || c.state === "waking") raise(ctx, "provider.unavailable", "This computer is still starting.");
  return { computer: c, host: toolHost(ctx) };
}

/** One call to agentd and everything after it: scrub, remember what was filled, keep the frame, add the step. Returns the capability's output. */
export async function call(ctx: CompCtx, r: Resolved, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  const c = r.computer;
  let raw: ToolAnswer;
  try {
    raw = await r.host.tool({ computerId: c.computerId, tool: spec.name, args, timeoutMs: Math.min(spec.timeoutMs ?? DEFAULT_TOOL_MS, MAX_TOOL_MS) });
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
  }
  return out;
}

/** The whole path for a tool with nothing special: prepare, call. */
export async function run(ctx: CompCtx, input: { computerId?: string | undefined }, spec: ToolSpec, args: ToolArgs): Promise<ToolAnswer> {
  const r = await prepare(ctx, input.computerId, spec);
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
