// Tools for a chat on an API key (ARCH 6.7): the API driver advertises the same tool set the MCP endpoint offers this agent for this asker, and each call runs as one capability invoke through
// the host's pipeline, as the agent acting for the asker (agent/src/drivers/open/api-tools.ts). This builds that from the host's `invoke` and the generated catalog, the way the MCP module does.
// @reads /generated/registry.json
// @reads /generated/mcp-tools.json
// @reads /docs/frozen/agent-tools.md
import { readFileSync } from "node:fs";
import { createApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import type { ApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import { createToolSession } from "../../agent/src/tools/call.ts";
import { decideLocal, dialFor, modePair } from "../../agent/src/tools/local.ts";
import { localFacts } from "../../agent/src/tools/local-facts.ts";
import type { ModePair } from "../../agent/src/tools/local.ts";
import { buildCatalog, offerable, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import { placeTools } from "./place-tools.ts";
import { DEFERRED_CAPS } from "../../host/src/routes/deferred.ts";
import type { AgentToolRow, McpToolRow, RegistryCapRow } from "../../agent/src/tools/types.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import type { AgentRules, Level, ThreadFacts } from "../../agent/src/tools/types.ts";
import type { CallHooks, DynamicTools } from "../../agent/src/tools/call.ts";
import type { ToolCtx, ToolDef } from "../../agent/src/tools/types.ts";
import type { SystemBlock } from "../../agent/src/drivers/api/types.ts";
import type { SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

interface SettingRow { value?: unknown; floor?: unknown }
export { modePair };

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

export interface EngineApiToolsDeps {
  invoke: Invoke;
  space: string;
  /** The agent's role as system prompt blocks. */
  system(spec: SessionSpec, input: TurnInput): Promise<SystemBlock[]>;
  /** Call a capability as a person: what the tool set of a turn depends on is read this way, before the turn's tools are chosen. */
  call?(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** The MCP tools of the agent's plugins and connections, and the plugin hooks around every call (modules/engine/plugin-tools.ts). */
  /** What each agent has used: counted after a call, read to list its top tools at the start of a turn (modules/engine/tool-use.ts). */
  usage?: { record(agentId: string, tool: string): void; top(agentId: string): readonly string[] };
  /** The one hooks layer for Vyre's own tools; replaces the plugin-only hooks. */
  hooks?: CallHooks;
  plugins?: { extra(ctx: ToolCtx): Promise<ToolDef[]>; dynamic: DynamicTools; hooks: CallHooks };
}

let catalog: ReturnType<typeof buildCatalog> | null = null;
let defaults: Set<string> | null = null;
/** Listed for every turn: an agent sees who is in and can message a teammate for its person (lane l-agentdm). */
import { ROOM_TOOLS, isRoom } from "./room-pack.ts";
export const TEAMMATE_TOOLS: readonly string[] = ["people_status", "message_person"];
/**
 * Listed for every turn too: the reads a question about the Inbox or a mail thread starts with. Found only through tool_search, a model asked "what came in about X" searched nineteen times and never
 * had them (a 7 minute, 1.5 million token turn). Every read an asked domain starts with belongs here.
 */
export const CORE_READ_TOOLS: readonly string[] = ["time_convert", "inbox_counts", "inbox_list_by_thread", "inbox_thread", "mail_thread_get", "mail_message_get"];

/** Reads that still run alone: they change what the agent can call, ask the person, park the turn, or hand the work on. */
export const SEQUENTIAL_READS: ReadonlySet<string> = new Set(["tool_search", "ask_question", "plan_propose", "wait_for", "handoff", "switch_model", "load_skill", "vault_request"]);

/** The tools that open or run a terminal. */
export const TERMINAL_TOOLS: readonly string[] = ["terminal_run", "terminal_request"];

export function createEngineApiTools(d: EngineApiToolsDeps): ApiTools {
  if (!catalog || !defaults) {
    const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
    const tools = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
    catalog = offerable(buildCatalog(reg.capabilities, tools, reg.agentTools), (cap) => DEFERRED_CAPS.has(cap));
    defaults = parseDefaultTools(read("docs/frozen/agent-tools.md"));
  }
  // What decides a turn's tool set is read as the asker before the set is built (the tool session asks synchronously): the agent's allow and deny lists, what the thread is (an Ask pane about an object,
  // plan mode), and the asker's level on that object. An Ask pane never offers more than the asker holds on what it is about.
  const rules = new Map<string, AgentRules>();
  const facts = new Map<string, Omit<ThreadFacts, "threadId">>();
  const levels = new Map<string, Level | null>();
  const modes = new Map<string, { terminal: ModePair; chrome: ModePair }>();
  /** Each asker's time zone (profile.timezone), read with the rest of what a turn depends on. */
  const zones = new Map<string, string>();
  const levelKey = (asker: string, scope: { type: string; id: string }): string => `${asker}|${scope.type}|${scope.id}`;
  const session = createToolSession({ nextHints: true, invoke: d.invoke, catalog, defaults, zoneOf: (c) => zones.get(c.asker), levelFor: (asker, scope) => levels.get(levelKey(asker, scope)) ?? null, canEngineer: () => false,
    // A local tool (terminal, Chrome, screen, files on the agent computer) follows the chat's mode, held to the owner's floor (the floor of Settings, This computer: Terminal prompts, Chrome prompts),
    // with the hard walls of the call itself (a path that leaves the work folder is refused, a delete outside it always asks). A "prompt" is not a refusal and not a silent run: the call is held at the Gate and
    // the person answers it in the chat. Settings are read as the asker before the turn (the tool session asks synchronously); one that cannot be read means the strictest mode.
    localPolicy: (t, ctx, input) => {
      const m = modes.get(ctx.asker);
      const dial = dialFor(ctx.thread.mode, t.local === "chrome" || t.local === "screen" ? m?.chrome : m?.terminal);
      return decideLocal(t, dial.person, dial.floor, localFacts(t, input));
    },
    ...(d.plugins ? { dynamic: d.plugins.dynamic } : {}), ...(d.hooks ? { hooks: d.hooks } : d.plugins ? { hooks: d.plugins.hooks } : {}) });
  const primed = new Set<string>();
  const hasHelpers = async (t: { threadId: string; asker: string }): Promise<boolean> => {
    if (!d.call) return false;
    try { return (((await d.call("chat.helpers.list", { threadId: t.threadId }, t.asker)) as { helpers?: unknown[] }).helpers?.length ?? 0) > 0; } catch { return false; }
  };
  const prepare = async (t: { threadId: string; agentId: string; asker: string; turnId: string }): Promise<void> => {
    if (!d.call || primed.has(t.turnId)) return;
    primed.add(t.turnId);
    if (primed.size > 500) primed.delete(primed.values().next().value as string);
    const [agent, thread] = await Promise.all([
      d.call("agents.get", { agentId: t.agentId }, t.asker).catch(() => undefined) as Promise<{ agent?: { toolsAllowed?: string[]; toolsDenied?: string[]; hasComputer?: boolean } } | undefined>,
      d.call("threads.get", { threadId: t.threadId }, t.asker).catch(() => undefined) as Promise<{ thread?: { kind?: ThreadFacts["kind"]; planMode?: boolean; mode?: ThreadFacts["mode"]; scopeType?: string; scopeId?: string } } | undefined>,
    ]);
    const [terminalMode, chromeMode] = await Promise.all(["security.terminal_mode", "security.chrome_mode"].map((key) => d.call!("settings.get", { key }, t.asker).catch(() => undefined) as Promise<{ row?: SettingRow } | undefined>));
    const tz = await d.call!("settings.get", { key: "profile.timezone" }, t.asker).catch(() => undefined) as { row?: { value?: unknown } } | undefined;
    if (typeof tz?.row?.value === "string" && tz.row.value !== "") zones.set(t.asker, tz.row.value);
    modes.set(t.asker, { terminal: modePair(terminalMode?.row, d.space), chrome: modePair(chromeMode?.row, d.space) });
    const a = agent?.agent;
    // A terminal on an agent computer is not built yet (the terminal host runs on a person's device only): an agent that has a computer is not offered the terminal tools, so it stops offering what cannot run.
    const deny = [...(a?.toolsDenied ?? []), ...(a?.hasComputer === true ? TERMINAL_TOOLS.filter((n) => !a.toolsDenied?.includes(n)) : [])];
    rules.set(t.agentId, { ...(a?.toolsAllowed?.length ? { allow: a.toolsAllowed } : {}), ...(deny.length ? { deny } : {}) });
    const th = thread?.thread;
    const scope = th?.scopeType && th.scopeId ? { type: th.scopeType, id: th.scopeId } : undefined;
    // who is in and a message to a teammate are listed in every chat, without a tool_search (owner ruling 3 Nov, lane l-agentdm)
    session.preload(t.threadId, TEAMMATE_TOOLS);
    session.preload(t.threadId, CORE_READ_TOOLS);
    if (isRoom(th as never)) session.preload(t.threadId, ROOM_TOOLS);   // a room's reads, so a tagged agent never searches before it speaks
    // a helper and the agent that started it talk with helper_note: listed in a helper chat and in the chat above it, so neither has to search for it
    if (th?.kind === "helper" || await hasHelpers(t)) session.preload(t.threadId, ["helper_note"]);
    // where the chat is decides which area's core tools are listed too (a goal chat the goal tools, an Ask about a file the file reads)
    session.preload(t.threadId, placeTools({ kind: th?.kind ?? "chat", scope }));
    // and the tools this agent reaches for most, learned from its own use
    if (d.usage) session.preload(t.threadId, d.usage.top(t.agentId));
    facts.set(t.threadId, { kind: th?.kind ?? "chat", planMode: th?.planMode === true, ...(th?.mode === "ask" || th?.mode === "auto" || th?.mode === "plan" ? { mode: th.mode } : {}), ...(scope ? { scope } : {}) });
    if (th?.kind === "ask" && scope) {
      const lvl = await d.call("chat.ask_level", { threadId: t.threadId }, t.asker).catch(() => undefined) as { level?: Level | null } | undefined;
      levels.set(levelKey(t.asker, scope), lvl?.level ?? null);
    }
  };
  // independent reads (no effect, no Gate rule, nothing local) may run together; everything else runs alone and in order
  const toolClass = (name: string): "read" | "other" => {
    const t = catalog!.byName(name);
    return t !== undefined && t.effects === "read" && !t.gated && t.local === "none" && !SEQUENTIAL_READS.has(name) ? "read" : "other";
  };
  const tools = createApiTools({ session, space: d.space, system: (spec, input) => d.system(spec, input), prepare, rules: (id) => rules.get(id), thread: (id) => facts.get(id), isRead: (n: string) => toolClass(n) === "read", ...(d.usage ? { used: (agentId: string, tool: string) => { if (!defaults!.has(tool)) d.usage!.record(agentId, tool); } } : {}), ...(d.plugins ? { extra: d.plugins.extra } : {}) });
  return { ...tools, toolClass };
}
