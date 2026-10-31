// The turn context builder (CHAT-DESIGN "The turn"): before each turn it asks the capabilities that know, as the person who is asking, and puts the answers in one ordered context
// (agent/src/turn-engine/context.ts). Every read runs as the asker, so a thing the asker may not see never reaches the agent through here. Every read is also optional: a capability that is
// slow, off or refuses leaves its section out and the turn goes on. Nothing in the context is a secret value; the Vault appears by item name only.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { SECTION_ORDER, parseScreen, screenText } from "../../agent/src/turn-engine/context.ts";
import type { ContextSection, ScreenContext, TurnContext } from "../../agent/src/turn-engine/context.ts";
import type { EngineSession, OpenSession, TurnInput } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
type Obj = Record<string, unknown>;

import { CONNECTOR_CHAT, CONNECTOR_SKILL } from "../../lib/connector-chat.ts";

/** The titles of the chats the Vault (Add to Automations) and the step picker (Build a connector) start, and the skill they run on. */
export { CONNECTOR_CHAT, CONNECTOR_SKILL };

/** The skills a turn can see: an index line each, and the body of one by name. The loader is the skills module's; this is the port the context binds to. */
export interface SkillsPort {
  index(agentId: string, asker: string): Promise<ReadonlyArray<{ name: string; description: string; tier: "builtin" | "space" | "agent" }>>;
  load(name: string, agentId: string, asker: string): Promise<{ name: string; body: string } | null>;
}

export interface ContextDeps {
  call: Call;
  skills?: SkillsPort;
  /** What the agent is waiting on in this thread: one plain line each (a held call, a wait_for, an unanswered question). */
  waiting?: (threadId: string, agentId: string) => string[] | Promise<string[]>;
  now?: () => number;
  /** How long a read that rarely changes is kept (names, AGENT.md, the Space). Default 30 s. */
  cacheMs?: number;
  /** One read gives up after this long. Default 1500 ms. */
  readMs?: number;
  /** Text for the one turn after a model switch (taken once): the engine the chat moved from and the summary it starts from. */
  handoff?: (threadId: string) => string | undefined;
}

/** Messages kept word for word once a summary stands for the older ones (the handoff and rollover rule: the last 20 turns). */
export const KEEP_TURNS = 20;

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** name and description of a SKILL.md, from its front matter. */
export function parseSkill(text: string): { name: string; description: string; body: string } | null {
  const m = FRONT.exec(text);
  if (!m) return null;
  const get = (k: string): string => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]!)?.[1]?.trim() ?? "";
  const name = get("name");
  return name === "" ? null : { name, description: get("description"), body: text.slice(m[0].length) };
}

/** The built-in skills shipped in agent/skills, read from disk. The skills module replaces this port when its loader lands. */
export function diskSkills(root: URL = new URL("../../agent/skills/", import.meta.url)): SkillsPort {
  const dirs = (): string[] => (existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
  const read = (dir: string): ReturnType<typeof parseSkill> => {
    try { return parseSkill(readFileSync(new URL(`${dir}/SKILL.md`, root), "utf8")); } catch { return null; }
  };
  return {
    async index() {
      return dirs().flatMap((d) => { const s = read(d); return s ? [{ name: s.name, description: s.description, tier: "builtin" as const }] : []; });
    },
    async load(name) {
      for (const d of dirs()) { const s = read(d); if (s && s.name === name) return { name: s.name, body: s.body }; }
      return null;
    },
  };
}

const cutTo = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const one = (s: unknown, n = 140): string => cutTo(String(s ?? "").replace(/\s+/g, " ").trim(), n);
const arr = <T = Obj>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** The words of a time in a zone: "Thursday 30 October 2026, 14:05 (Asia/Karachi)". An unknown zone falls back to UTC. */
export function timeLine(at: number, zone?: string): string {
  const fmt = (tz: string): string => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(at);
  let tz = zone && zone !== "" ? zone : "UTC";
  let text: string;
  try { text = fmt(tz); } catch { tz = "UTC"; text = fmt(tz); }
  return `It is ${text.replace(" at ", ", ")} (${tz}).`;
}

/** A routine or watcher in one line the agent can act on: kind, title, when, state, id. */
export function routineLine(r: Obj): string {
  const kind = r["kind"] === "watch" ? "watcher" : "schedule";
  const watch = r["watch"] as Obj | undefined;
  const when = kind === "watcher" ? `on each new message in ${str(watch?.["channelId"]) ?? str(r["channelId"]) ?? "a channel"}` : `cron "${str(r["cron"]) ?? "?"}"`;
  const next = typeof r["nextRunAt"] === "number" ? `, next ${new Date(r["nextRunAt"]).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
  return `- ${kind} "${one(r["title"], 80)}" ${when}${next}${r["enabled"] === false ? ", paused" : ""} (${str(r["routineId"]) ?? "?"})`;
}

const handoffs = new Map<string, string>();
/** Remember what the next turn of a thread is told after a model switch. Taken once. */
export function noteHandoff(threadId: string, text: string): void { handoffs.set(threadId, text); }
export function takeHandoff(threadId: string): string | undefined { const t = handoffs.get(threadId); handoffs.delete(threadId); return t; }

export function createContextBuilder(d: ContextDeps) {
  const now = d.now ?? Date.now;
  const keep = d.cacheMs ?? 30_000;
  const readMs = d.readMs ?? 1_500;
  const cache = new Map<string, { at: number; v: unknown }>();

  /** One optional read as `as`: the answer, or undefined when it failed, was refused or took too long. */
  async function read<T = Obj>(cap: string, input: unknown, as: string): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return (await Promise.race([
        d.call(cap, input, as) as Promise<T>,
        new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), readMs); timer.unref?.(); }),
      ])) ?? undefined;
    } catch { return undefined; } finally { if (timer) clearTimeout(timer); }
  }
  /** A read kept for a short while, per key (a person's reach differs, so the key names the asker where it matters). */
  async function kept<T>(key: string, f: () => Promise<T | undefined>): Promise<T | undefined> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < keep) return hit.v as T | undefined;
    const v = await f();
    if (v !== undefined) cache.set(key, { at: now(), v });
    return v;
  }

  async function names(asker: string): Promise<Record<string, string>> {
    const out = await kept<Obj>(`names:${asker}`, () => read("access.principals.list", { limit: 500 }, asker));
    const map: Record<string, string> = {};
    for (const p of arr(out?.["principals"])) { const id = str(p["id"]), n = str(p["name"]); if (id && n) map[id] = n; }
    return map;
  }

  /** The file text of AGENT.md in the agent's folder, cut. */
  async function agentMd(agent: Obj, asker: string): Promise<string | undefined> {
    const folder = str(agent["folderId"]);
    if (!folder) return undefined;
    return kept<string>(`md:${asker}:${folder}`, async () => {
      const ls = await read<Obj>("files.list", { section: "space", folder, limit: 50 }, asker);
      const f = arr(ls?.["files"]).find((x) => str(x["name"]) === "AGENT.md");
      const id = str(f?.["fileId"]) ?? str(f?.["id"]);
      if (!id) return undefined;
      const body = await read<Obj>("files.read", { fileId: id, as: "text", length: 8_000 }, asker);
      return str(body?.["text"]);
    });
  }

  async function scopeLine(scopeType: string | undefined, scopeId: string | undefined, asker: string): Promise<string | undefined> {
    if (!scopeType || !scopeId) return undefined;
    let title: string | undefined;
    if (scopeType === "project") title = str(((await read<Obj>("projects.get", { projectId: scopeId }, asker))?.["project"] as Obj | undefined)?.["title"]);
    else if (scopeType === "task") title = str(((await read<Obj>("tasks.get", { taskId: scopeId }, asker))?.["task"] as Obj | undefined)?.["title"]);
    return `about ${scopeType} ${scopeId}${title ? ` "${one(title, 80)}"` : ""}`;
  }

  /**
   * The screen the person sent with the message that caused the turn (chat.screen.get, read as them). A turn woken without a message gets their newest. A message sent without a screen has none:
   * an earlier screen would point at things the person has since left.
   */
  async function screenOf(input: TurnInput): Promise<ScreenContext | undefined> {
    const out = await read<Obj>("chat.screen.get", { threadId: input.threadId, ...(input.trigger ? { messageId: input.trigger.id } : {}) }, input.asker);
    return parseScreen(out?.["screen"]);
  }

  async function build(input: TurnInput): Promise<TurnContext> {
    const asker = input.asker;
    const agentId = input.agent.id;
    const [reviewerOut, screen, summary, agentOut, thread, nameMap, space, routines, zone, waits, computers] = await Promise.all([
      read<Obj>("engine.reviewer.get", { threadId: input.threadId }, asker),
      screenOf(input),
      read<Obj>("chat.transcript.summary", { threadId: input.threadId }, asker),
      read<Obj>("agents.get", { agentId }, asker),
      read<Obj>("threads.get", { threadId: input.threadId }, asker),
      names(asker),
      kept<Obj>(`space:${asker}`, () => read("spaces.get", {}, asker)),
      read<Obj>("agents.routines.list", { agentId }, asker),
      kept<Obj>(`tz:${asker}`, () => read("settings.get", { key: "profile.timezone" }, asker)),
      Promise.resolve(d.waiting?.(input.threadId, agentId)).catch(() => undefined),
      read<Obj>("computers.list", { limit: 50 }, asker),
    ]);
    const agent = (agentOut?.["agent"] as Obj | undefined) ?? undefined;
    const th = (thread?.["thread"] as Obj | undefined) ?? undefined;
    const sections: ContextSection[] = [];
    const add = (id: ContextSection["id"], stable: boolean, text: string): void => { if (text.trim() !== "") sections.push({ id, stable, text }); };

    // identity
    const name = str(agent?.["name"]) ?? input.agent.name ?? agentId;
    const role = str(agent?.["role"]) ?? input.agent.role;
    const md = agent ? await agentMd(agent, asker) : undefined;
    add("identity", true, `You are ${name} (agentId ${agentId}), an agent in Vyre.${role ? ` ${role}` : ""}${md ? `\n\nYour AGENT.md:\n${cutTo(md, 6_000)}` : ""}`);
    add("rules", true, "You work for the person who asked; their access limits yours. Search Vyre memory before you ask them anything. A secret is used by Vault handle (vault_use), never by value. Anything that leaves the Space goes through the Gate and may come back held: say what is waiting and for whom. Say what you did and what you did not do.");

    // where
    const people = arr(th?.["members"]).filter((m) => m["kind"] === "person").map((m) => String(m["id"]));
    const agents = arr(th?.["agents"]).map((a) => ({ id: String(a["agentId"]), mode: String(a["mode"] ?? "") }));
    const who = (id: string): string => nameMap[id] ?? (id === agentId ? name : id.startsWith("agt_") ? "an agent" : "a teammate");
    const where: string[] = [];
    const spaceRow = space?.["space"] as Obj | undefined;
    if (str(spaceRow?.["name"])) where.push(`Space: ${str(spaceRow?.["name"])}${str(spaceRow?.["kind"]) ? ` (${str(spaceRow?.["kind"])})` : ""}.`);
    const kind = str(th?.["kind"]) ?? "chat";
    const scope = await scopeLine(str(th?.["scopeType"]), str(th?.["scopeId"]), asker);
    const title = str(th?.["title"]);
    where.push(`threadId ${input.threadId}. This is ${kind === "ask" ? "an Ask thread, private to you and the person" : kind === "channel" ? "a channel" : kind === "thread" ? "a thread" : "a chat"}${title ? ` called "${one(title, 80)}"` : ""}${scope ? `, ${scope}` : ""}.`);
    where.push(`You are talking with ${who(asker)} (${asker}; they asked, they pay, and their access limits yours).`);
    const others = people.filter((p) => p !== asker);
    if (others.length > 0) where.push(`Also here: ${others.slice(0, 12).map(who).join(", ")}.`);
    const mates = agents.filter((a) => a.id !== agentId);
    if (mates.length > 0) where.push(`Agents here: ${mates.slice(0, 8).map((a) => `${who(a.id)} (${a.mode || "listening"})`).join(", ")}.`);
    const rv = reviewerOut?.["reviewer"] as { kind?: string; id?: string } | null | undefined;
    if (rv?.id) {
      if (rv.kind === "agent" && rv.id === agentId) where.push(`You are the reviewer of this chat. When you are asked, read the lead agent's last answer and what it changed, check it against what ${who(asker)} asked, and say Approved or list what is wrong. Address your verdict to ${who(asker)} with a mention.`);
      else where.push(`${who(rv.id)} reviews the work done here before it counts. Say plainly what you did, so it can be checked.`);
    }
    const chatMode = th?.["mode"];
    if (chatMode === "plan" || (chatMode === undefined && th?.["planMode"] === true)) where.push("Mode: Plan. Read and plan, change nothing until the person approves a plan. Propose the plan with plan_propose, then wait.");
    else if (chatMode === "ask") where.push("Mode: Ask first. Before you change or send anything, say what you are about to do. A change that needs a yes waits for it: a held tool call is not a failure, tell the person it is waiting. Your own file-changing and shell tools are not available in this mode; if you need them, say so and the person can switch the chat to Auto.");
    else if (chatMode === "auto") where.push("Mode: Auto. Act on your own without asking. Anything that leaves Vyre (an email, a text, a post, a payment) is still held for a yes.");
    add("where", true, where.join("\n"));

    // skills: the manual is always in front of the agent; the other skills are an index, and the place's focus skill is loaded for it
    // A chat that Add to Automations or Build a connector started is a connector build whatever screen it was sent from: that skill is the focus. Anywhere else it is in the skills index by its description.
    const connectorChat = CONNECTOR_CHAT.test(str(th?.["title"]) ?? "");
    const focusName = connectorChat ? CONNECTOR_SKILL : screen?.focus ?? (screen ? `focus-${screen.place}` : undefined);
    if (d.skills) {
      const idx = await d.skills.index(agentId, asker).catch(() => []);
      const manual = await d.skills.load("working-in-vyre", agentId, asker).catch(() => null);
      const others = idx.filter((s) => s.name !== "working-in-vyre");
      const parts: string[] = [];
      if (manual) parts.push(`Working in Vyre (always loaded):\n${manual.body.trim()}`);
      if (others.length > 0) parts.push(`Other skills, by name. Load one with agents_builtin_skill_get when it fits what you are doing:\n${others.map((s) => `- ${s.name}: ${one(s.description, 130)}`).join("\n")}`);
      add("skills", true, parts.join("\n\n"));
      if (focusName && idx.some((s) => s.name === focusName)) {
        const f = await d.skills.load(focusName, agentId, asker).catch(() => null);
        if (f) add("focus", false, `${f.name}\n${cutTo(f.body.trim(), 8_000)}`);
      }
    }

    // what it can do here
    const can: string[] = [];
    if (agent) {
      const allowed = arr<string>(agent["toolsAllowed"]), denied = arr<string>(agent["toolsDenied"]);
      can.push(allowed.length > 0 ? `Tools limited to: ${allowed.slice(0, 40).join(", ")}.` : "Tools: every tool you are shown, within the person's access.");
      if (denied.length > 0) can.push(`Tools you may not use: ${denied.slice(0, 40).join(", ")}.`);
      can.push("Find tools you do not see with tool_search.");
      const keys = arr<string>(agent["vaultKeys"]);
      can.push(keys.length > 0 ? `Vault items you may use by handle: ${keys.slice(0, 30).map((k) => `#${k.replace(/^#/, "")}`).join(", ")} (call vault_use; you never see the value).` : "Vault: no items are set for you; ask with vault_request when you need a key.");
      const lim = agent["limits"] as Obj | undefined;
      const caps = lim ? Object.entries(lim).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k} ${v}`) : [];
      if (caps.length > 0) can.push(`Your limits: ${caps.join(", ")}.`);
      const rs = arr(routines?.["routines"]);
      can.push("Your own loops: a schedule (a cron) or a watcher (kind watch: runs on each new message in a channel) you set for yourself. Make or change one with agents_routine_save (give routineId to change), see them with agents_routines_list, remove one with agents_routine_delete. Cron runs in UTC: convert the person's time (see the time line) and say both. They show on your page and in this chat's Routines tab. When a person says \"every Monday\" or \"whenever X is posted\", make the loop; do not just promise to remember.");
      can.push(rs.length > 0 ? `Your routines and watchers now:\n${rs.slice(0, 20).map(routineLine).join("\n")}` : "You have no routines or watchers yet.");
      if (agent["hasComputer"] === true) {
        const c = arr(computers?.["computers"]).find((x) => str(x["agentId"]) === agentId);
        can.push(c ? `Your computer is ${str(c["state"])}${typeof c["tabs"] === "number" ? `, ${c["tabs"]} tab${c["tabs"] === 1 ? "" : "s"} open` : ""}${str(c["caption"]) ? `: ${one(c["caption"], 100)}` : ""}${str(c["takeoverBy"]) ? ` (${who(String(c["takeoverBy"]))} is in control)` : ""}.` : "You have a computer; it is not listed for this person.");
      } else can.push("You have no computer. Ask for one with computers_provision only when a task needs a browser.");
    }
    add("can", true, can.join("\n"));

    const older = str(summary?.["summary"]);
    if (older) add("earlier", false, `${cutTo(older, 8_000)}\nThe full transcript is chats/${input.threadId}/transcript.md; transcript_search finds an exact line.`);
    const taken = d.handoff?.(input.threadId);
    if (taken) add("handoff", false, taken);
    add("screen", false, screenText(screen));
    add("now", false, timeLine(now(), str(((zone?.["row"] as Obj | undefined)?.["value"])) ));
    const w = (waits ?? []).filter((x) => x !== "");
    if (w.length > 0) add("waiting", false, w.map((x) => `- ${x}`).join("\n"));

    const ordered = SECTION_ORDER.flatMap((id) => sections.filter((s) => s.id === id));
    return { sections: ordered, names: nameMap, ...(screen ? { screen } : {}), ...(older ? { keepHistory: KEEP_TURNS } : {}) };
  }

  return { build };
}

export type ContextBuilder = ReturnType<typeof createContextBuilder>;

/** An OpenSession whose sessions get the turn context on every send. A context that fails to build never holds the turn: it runs without. */
export function withTurnContext(open: OpenSession, b: ContextBuilder): OpenSession {
  return async (spec) => {
    const session = await open(spec);
    return Object.create(session, {
      send: {
        value: (input: TurnInput) => (async function* () {
          let context: TurnContext | undefined;
          try { context = await b.build(input); } catch { context = undefined; }
          yield* session.send(context ? { ...input, context, ...(context.keepHistory !== undefined && input.history.length > context.keepHistory ? { history: input.history.slice(-context.keepHistory) } : {}) } : input);
        })(),
      },
    }) as EngineSession;
  };
}
