// The one Add people and agents host. Every entry point (the composer's +, the conversation header, the people menu, a channel's or a thread's members, a project's members and teammates,
// the new-chat landing) calls `open(...)` on this hook and draws its `element`, so the same ui/AccessSheet opens with the same directory, the same "Here now" and the same calls.
// It reads what the sheet needs through the capability door (the thread or channel or project, the Space's people and agents, the person's outside agents, the link command, and the
// person's own access so a viewer can give viewing only), turns the picks into calls with the sheet's own addCalls, runs them in order and says the result in one line.
// It also owns the people menu of a chat and the response-settings popover of one agent (How, When, Style), because both are the same settings the sheet's gear edits.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useWindowDimensions } from "react-native";
import { AccessSheet, AgentSettingsPopover, AccessFace, addCalls, agentSettingsInput, outsideAgentRemoveInput, pokeInput } from "../../../../../../ui/src/AccessSheet/index.tsx";
import type { AccessDirectory, AccessEntry, AccessPick, AddContext, AddTarget, AgentSettings, LinkInfo, ShareLevel } from "../../../../../../ui/src/AccessSheet/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { swapNeeded } from "../conversation/model.ts";
import { PeoplePop } from "./PeoplePop.tsx";
import type { PeopleRow } from "./PeoplePop.tsx";
import { addedLine, addsSomeone, directoryOf, failedLine, hereSub, maxLevelOf, projectExtras, settingsOf, titleOfTarget } from "./model.ts";
import type { AddOpen, AddSheetDeps, ThreadAgentRow, ThreadRow } from "./model.ts";

type Out<K extends keyof CapMap> = CapMap[K]["out"];

/** What one open sheet knows once it has read everything. */
interface Loaded {
  ctx: AddContext;
  target: AddTarget;
  /** The thread an agent is poked and set up in: a chat's own, a channel's main chat, a project's chat (when it has one). Null: no thread to poke in. */
  threadId: string | null;
  directory: AccessDirectory;
  here: AccessEntry[];
  agentSettings: Record<string, AgentSettings>;
  maxLevel?: ShareLevel;
  link?: LinkInfo;
}

const MODELS: readonly string[] = ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "GPT-5 Codex"];

async function tryCall<T>(deps: AddSheetDeps, cap: string, input: unknown): Promise<T | null> {
  try { return (await deps.call(cap, input)) as T; } catch { return null; }
}

/** Reads the target and the directory. A directory part that cannot be read leaves that list empty; a target that cannot be read opens nothing. */
export async function loadAdd(deps: AddSheetDeps, open: AddOpen, copy?: (text: string) => void): Promise<Loaded | null> {
  const me = deps.me.id;
  let ctx: AddContext;
  let kind: AddTarget["kind"];
  let name: string;
  let threadId: string | null = null;
  let resource: { type: "thread" | "channel" | "project"; id: string };
  let hereRows: { kind: "person" | "agent" | "outside"; id: string }[] = [];
  let agentRows: ThreadAgentRow[] = [];
  let projectId: string | undefined;
  const agentsOut = tryCall<Out<"agents.list">>(deps, "agents.list", {});
  if ("threadId" in open) {
    const got = await tryCall<Out<"threads.get">>(deps, "threads.get", { threadId: open.threadId });
    if (!got) return null;
    const t: ThreadRow = got.thread;
    threadId = t.threadId;
    agentRows = t.agents;
    if (t.kind === "channel") {
      const channelId = t.channelId ?? t.threadId;
      const ch = await tryCall<Out<"channels.get">>(deps, "channels.get", { channelId });
      ctx = { kind: "channel", channelId, mainThreadId: ch?.channel.mainThreadId ?? t.threadId };
      kind = "channel";
      name = titleOfTarget("channel", ch?.channel.name ?? open.name ?? t.title ?? "this channel");
      resource = { type: "channel", id: channelId };
      hereRows = (ch?.channel.members ?? t.members).filter((m) => m.kind === "person").map((m) => ({ kind: "person", id: m.id }));
    } else {
      kind = t.kind === "thread" ? "thread" : "chat";
      ctx = { kind, threadId: t.threadId };
      name = open.name ?? t.title ?? (kind === "thread" ? "this thread" : "this chat");
      resource = { type: "thread", id: t.threadId };
      hereRows = t.members.filter((m) => m.kind === "person").map((m) => ({ kind: "person", id: m.id }));
    }
  } else {
    projectId = open.projectId;
    kind = "project";
    const ov = await tryCall<Out<"projects.overview">>(deps, "projects.overview", { projectId });
    const mem = await tryCall<Out<"projects.members.list">>(deps, "projects.members.list", { projectId });
    name = open.name ?? ov?.project.title ?? "this project";
    ctx = { kind: "project", projectId };
    resource = { type: "project", id: projectId };
    hereRows = (mem?.members ?? []).filter((m) => m.kind !== "group").map((m) => ({ kind: m.kind === "agent" ? "agent" : "person", id: m.principal }));
    // a project's outside agents and guests belong to its chat: its main thread
    const chId = ov?.project.channelId;
    if (chId) {
      const ch = await tryCall<Out<"channels.get">>(deps, "channels.get", { channelId: chId });
      if (ch) threadId = ch.channel.mainThreadId;
    }
  }
  const [principals, agents, connected, link, checks] = await Promise.all([
    tryCall<Out<"access.principals.list">>(deps, "access.principals.list", {}),
    agentsOut,
    tryCall<Out<"mcp.connected.list">>(deps, "mcp.connected.list", {}),
    tryCall<Out<"mcp.connected.link">>(deps, "mcp.connected.link", {}),
    Promise.all((["manage", "edit", "use"] as const).map((level) => tryCall<Out<"access.check">>(deps, "access.check", { principal: { kind: "person", id: me }, action: { level }, resource }))),
  ]);
  const dir = directoryOf({ me, principals: principals?.principals ?? [], agents: agents?.agents ?? [], connected: connected?.agents ?? [], ...(projectId !== undefined ? { projectId } : {}) });
  const rowOf = new Map((agents?.agents ?? []).map((a) => [a.agentId, a] as const));
  const agentSettings: Record<string, AgentSettings> = {};
  const here: AccessEntry[] = hereRows.filter((h) => h.id !== me).map((h) => ({ id: h.id, name: deps.nameOf(h.id), sub: h.kind === "person" ? "Person" : "Project teammate", kind: h.kind }));
  const only = agentRows.length === 1;
  for (const a of agentRows) {
    const row = rowOf.get(a.agentId);
    const outside = row?.runtime === "outside";
    agentSettings[a.agentId] = settingsOf(a);
    here.push({ id: a.agentId, name: deps.nameOf(a.agentId), sub: hereSub(a, only), kind: outside ? "outside" : "agent", ...(row !== undefined && row.kind === "assistant" ? { assistant: true } : {}) });
  }
  const answers = checks.map((c) => c?.decision.effect === "allow");
  const known = checks.some((c) => c !== null);
  const maxLevel = known ? maxLevelOf({ manage: answers[0] === true, edit: answers[1] === true, use: answers[2] === true }) : undefined;
  const target: AddTarget = { kind, name, filesFolder: name, recordsFolder: name };
  const info: LinkInfo | undefined = link
    ? { command: link.claudeCode, ...(connected && connected.agents.length > 0 ? { connected: (connected.agents[0] as { clientName: string }).clientName } : {}), onCopy: () => { (copy ?? ((t: string) => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(t); }))(link.claudeCode); } }
    : undefined;
  return { ctx, target, threadId, directory: dir, here, agentSettings, ...(maxLevel !== undefined ? { maxLevel } : {}), ...(info ? { link: info } : {}) };
}

/** The directory for a chat that does not exist yet (the new-chat landing): nobody is in it, nothing can be poked, and the picks go back to the caller instead of into calls. */
export async function loadPick(deps: AddSheetDeps, name: string, copy?: (text: string) => void): Promise<Loaded> {
  const [principals, agents, connected, link] = await Promise.all([
    tryCall<Out<"access.principals.list">>(deps, "access.principals.list", {}),
    tryCall<Out<"agents.list">>(deps, "agents.list", {}),
    tryCall<Out<"mcp.connected.list">>(deps, "mcp.connected.list", {}),
    tryCall<Out<"mcp.connected.link">>(deps, "mcp.connected.link", {}),
  ]);
  const info: LinkInfo | undefined = link ? { command: link.claudeCode, onCopy: () => { (copy ?? ((t: string) => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(t); }))(link.claudeCode); } } : undefined;
  return {
    ctx: { kind: "chat", threadId: "" }, target: { kind: "chat", name, filesFolder: name, recordsFolder: name }, threadId: null,
    directory: directoryOf({ me: deps.me.id, principals: principals?.principals ?? [], agents: agents?.agents ?? [], connected: connected?.agents ?? [] }), here: [], agentSettings: {}, ...(info ? { link: info } : {}),
  };
}

/** Which pick a call was for, by name, so a failure can say who was not added. */
function nameOfCall(call: { cap: string; input: unknown }, picks: readonly AccessPick[]): string[] {
  const i = call.input as Record<string, unknown>;
  const byId = (id: unknown): string[] => picks.filter((p) => p.id === id).map((p) => p.name);
  switch (call.cap) {
    case "channels.members.add": return picks.filter((p) => (i["personIds"] as string[]).includes(p.id)).map((p) => p.name);
    case "threads.members.add": return byId(i["personId"]);
    case "threads.add_agent": case "threads.outside_agent.add": case "threads.agent_settings.set": return byId(i["agentId"]);
    case "projects.members.set": return byId(i["principal"]);
    case "threads.invite_guest": return picks.filter((p) => p.email === i["email"]).map((p) => p.name);
    case "threads.agent.create": case "agents.create": return picks.filter((p) => p.name === i["name"]).map((p) => p.name);
    default: return [];
  }
}

/** Runs the sheet's picks: people first, then agents, then settings, new agents and guests, in the order addCalls plans. Says one line after. */
export async function runAdd(deps: AddSheetDeps, r: Loaded, picks: readonly AccessPick[], earlier = false): Promise<{ added: string[]; failed: string[] }> {
  const key = (): string => deps.newKey();
  const plan = addCalls(r.ctx, picks, key, { earlier });
  const queue: { cap: string; input: unknown }[] = plan.calls.map((c) => ({ cap: c.cap, input: c.input }));
  if (r.ctx.kind === "project") {
    const extra = projectExtras(plan.unsupported, key);
    for (const c of extra.creates) queue.push({ cap: "agents.create", input: { name: c.name, ...(c.role !== undefined ? { role: c.role } : {}), ...(c.model !== undefined ? { model: c.model } : {}), projectId: r.ctx.projectId, idempotencyKey: c.key } });
    // an outside agent or a guest on a project goes to the project's chat
    if (extra.viaChat.length > 0 && r.threadId !== null) {
      for (const c of addCalls({ kind: "chat", threadId: r.threadId }, extra.viaChat, key).calls) queue.push({ cap: c.cap, input: c.input });
    }
  }
  const added: string[] = [];
  const failed: string[] = [];
  for (const c of queue) {
    const names = nameOfCall(c, picks);
    try {
      await deps.call(c.cap, c.input);
      if (addsSomeone(c as never)) for (const n of names) if (!added.includes(n)) added.push(n);
    } catch {
      for (const n of names) if (!failed.includes(n)) failed.push(n);
    }
  }
  return { added: added.filter((n) => !failed.includes(n)), failed };
}

/* ---------- the hook ---------- */

type Surface =
  | { k: "sheet"; open: AddOpen; r: Loaded }
  | { k: "pick"; r: Loaded; onPicks(picks: readonly AccessPick[]): void }
  | { k: "people"; thread: ThreadRow; x: number; y: number; onOpenAgent(id: string): void; outside: ReadonlySet<string> }
  | { k: "settings"; thread: ThreadRow; agentId: string; x: number; y: number; outside: ReadonlySet<string> };

export interface AddSheetApi {
  /** Opens the sheet on a chat, channel or thread (by its thread id) or on a project. */
  open(target: AddOpen): void;
  /** The same sheet for a chat that does not exist yet: nothing is called, the picks go to `onPicks`. */
  pick(p: { name: string; onPicks(picks: readonly AccessPick[]): void }): void;
  /** The people-count menu of a chat: who is here, "Add people and agents" first, Poke and a gear on every agent. */
  showPeople(p: { thread: ThreadRow; x: number; y: number; onOpenAgent(agentId: string): void }): void;
  /** The response-settings popover of one agent already in the chat. */
  showSettings(p: { thread: ThreadRow; agentId: string; x: number; y: number }): void;
  /** True while a sheet or popover from this host is drawn. */
  isOpen: boolean;
  /** Draw this once in the place; it is null while nothing is open. */
  element: ReactElement | null;
}

export function useAddSheet(deps: AddSheetDeps, opts: { onDone?: () => void; copy?: (text: string) => void } = {}): AddSheetApi {
  const win = useWindowDimensions();
  const menu = useMenu();
  const [surface, setSurface] = useState<Surface | null>(null);
  const d = useRef(deps);
  d.current = deps;
  const o = useRef(opts);
  o.current = opts;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useRef<(() => void) | null>(null);
  useEffect(() => () => { if (pending.current) { clearTimeout(pending.current); flush.current?.(); } }, []);

  const close = useCallback(() => { if (pending.current) { clearTimeout(pending.current); pending.current = null; flush.current?.(); flush.current = null; } setSurface(null); }, []);

  const open = useCallback((target: AddOpen): void => {
    void loadAdd(d.current, target, o.current.copy).then((r) => {
      if (r === null) { d.current.toast("Could not open that. Try again."); return; }
      setSurface({ k: "sheet", open: target, r });
    });
  }, []);

  const pick = useCallback((p: { name: string; onPicks(picks: readonly AccessPick[]): void }): void => {
    void loadPick(d.current, p.name, o.current.copy).then((r) => setSurface({ k: "pick", r, onPicks: p.onPicks }));
  }, []);

  const poke = useCallback((threadId: string | null, agentId: string, here: readonly { id: string }[]): void => {
    const name = d.current.nameOf(agentId);
    if (threadId === null || !here.some((e) => e.id === agentId)) { d.current.toast(`Add ${name} first, then poke it.`); return; }
    void Promise.resolve(d.current.call("threads.poke", pokeInput(threadId, agentId))).then(() => d.current.toast(`Poked ${name}`), () => d.current.toast(`Could not poke ${name}. Try again.`));
  }, []);

  /** Saves one agent's answers in one chat. Writing in the settings fields saves a moment after the last key; a pick saves at once. */
  const save = useCallback((threadId: string, agentId: string, next: AgentSettings, wait: boolean): void => {
    const run = (): void => { pending.current = null; flush.current = null; void Promise.resolve(d.current.call("threads.agent_settings.set", agentSettingsInput(threadId, agentId, next))).then(() => undefined, () => d.current.toast(`Could not change how ${d.current.nameOf(agentId)} answers. Try again.`)); };
    if (pending.current) clearTimeout(pending.current);
    if (!wait) { pending.current = null; flush.current = null; run(); return; }
    flush.current = run;
    pending.current = setTimeout(run, 400);
  }, []);

  /** The agents here that run outside Vyre (agents.list says so): they cannot answer everything, so their settings never offer it. */
  const outsideOf = useCallback(async (): Promise<ReadonlySet<string>> => {
    const got = await tryCall<Out<"agents.list">>(d.current, "agents.list", {});
    return new Set((got?.agents ?? []).filter((a) => a.runtime === "outside").map((a) => a.agentId));
  }, []);
  /** The chat's agents as the server keeps them: the copy a screen holds may leave out how each answers (Listening, When, Style). */
  const freshThread = useCallback(async (seen: ThreadRow): Promise<ThreadRow> => (await tryCall<Out<"threads.get">>(d.current, "threads.get", { threadId: seen.threadId }))?.thread ?? seen, []);
  const showPeople = useCallback((p: { thread: ThreadRow; x: number; y: number; onOpenAgent(agentId: string): void }): void => { void Promise.all([outsideOf(), freshThread(p.thread)]).then(([outside, thread]) => setSurface({ k: "people", ...p, thread, outside })); }, [outsideOf, freshThread]);
  const showSettings = useCallback((p: { thread: ThreadRow; agentId: string; x: number; y: number }): void => { void Promise.all([outsideOf(), freshThread(p.thread)]).then(([outside, thread]) => setSurface({ k: "settings", ...p, thread, outside })); }, [outsideOf, freshThread]);

  let element: ReactElement | null = null;
  if (surface?.k === "sheet") {
    const { r } = surface;
    const phone = win.width > 0 && win.width < 640;
    const sameThread = r.threadId;
    element = (
      <AccessSheet
        mode="add" density={phone ? "compact" : "regular"} ownerName={deps.me.name} target={r.target} directory={r.directory} here={r.here} agentSettings={r.agentSettings} models={MODELS}
        earlierMessages={r.target.kind === "chat" || r.target.kind === "thread"} {...(r.maxLevel !== undefined ? { maxLevel: r.maxLevel } : {})} {...(r.link ? { link: r.link } : {})} testID="add-sheet" onClose={close}
        {...(sameThread !== null ? { onPoke: (id: string) => poke(sameThread, id, r.here), onAgentSettings: (id: string, s: AgentSettings) => save(sameThread, id, s, true) } : {})}
        {...(sameThread !== null ? { onRemoveHere: (e: AccessEntry) => {
          void Promise.resolve(d.current.call("threads.outside_agent.remove", outsideAgentRemoveInput(sameThread, e.id))).then(
            () => { d.current.toast(`${e.name} was removed`); setSurface((s) => (s?.k === "sheet" ? { ...s, r: { ...s.r, here: s.r.here.filter((x) => x.id !== e.id) } } : s)); o.current.onDone?.(); },
            () => d.current.toast(`Could not remove ${e.name}. Try again.`),
          );
        } } : {})}
        onAdd={(picks, opts) => {
          void runAdd(d.current, r, picks, opts.earlier).then(({ added, failed }) => {
            if (added.length > 0) d.current.toast(addedLine(added));
            if (failed.length > 0) d.current.toast(failedLine(failed));
            o.current.onDone?.();
          });
        }}
      />
    );
  } else if (surface?.k === "pick") {
    const { r, onPicks } = surface;
    const phone = win.width > 0 && win.width < 640;
    element = (
      <AccessSheet
        mode="add" density={phone ? "compact" : "regular"} ownerName={deps.me.name} target={r.target} directory={r.directory} here={r.here} models={MODELS} earlierMessages={false}
        {...(r.link ? { link: r.link } : {})} testID="add-sheet" onClose={close} onAdd={(picks) => { onPicks(picks); }}
      />
    );
  } else if (surface?.k === "people") {
    const t = surface.thread;
    const only = t.agents.length === 1;
    const rows: PeopleRow[] = [
      ...t.members.filter((m) => m.kind === "person").map((m): PeopleRow => ({ id: m.id, name: deps.nameOf(m.id), kind: "person", sub: m.id === deps.me.id ? "You" : "Person" })),
      ...t.agents.map((a): PeopleRow => ({ id: a.agentId, name: deps.nameOf(a.agentId), kind: surface.outside.has(a.agentId) ? "outside" : "agent", sub: hereSub(a, only) })),
    ];
    element = (
      <PeoplePop
        title={`${t.members.length} in this ${t.kind === "channel" ? "channel" : t.kind === "thread" ? "thread" : "chat"}`} rows={rows} anchor={{ x: surface.x, y: surface.y }}
        onAdd={() => { const id = t.threadId; setSurface(null); open({ threadId: id }); }} onPoke={(id) => poke(t.threadId, id, t.agents.map((a) => ({ id: a.agentId })))}
        onGear={(id, x, y) => setSurface({ k: "settings", thread: t, agentId: id, x, y, outside: surface.outside })} onOpenAgent={(id) => { const go = surface.onOpenAgent; setSurface(null); go(id); }} onClose={close}
      />
    );
  } else if (surface?.k === "settings") {
    element = <ChatAgentSettings deps={deps} thread={surface.thread} agentId={surface.agentId} outside={surface.outside.has(surface.agentId)} x={surface.x} y={surface.y} save={save} poke={poke} confirm={(entries, x, y, label) => menu.show(entries, x, y, "other", { label })} onClose={close} />;
  }
  return {
    open, pick, showPeople, showSettings, isOpen: surface !== null,
    element: element === null && menu.element === null ? null : <>{element}{menu.element}</>,
  };
}

/** The settings popover of an agent already in a chat. Making another agent the lead asks first: one lead per chat, and the old lead keeps listening. */
function ChatAgentSettings({ deps, thread, agentId, outside, x, y, save, poke, confirm, onClose }: {
  deps: AddSheetDeps; thread: ThreadRow; agentId: string; outside: boolean; x: number; y: number;
  save(threadId: string, agentId: string, next: AgentSettings, wait: boolean): void;
  poke(threadId: string | null, agentId: string, here: readonly { id: string }[]): void;
  confirm(entries: import("../../../../../../ui/src/Menu/index.tsx").MenuEntry[], x: number, y: number, label: string): void;
  onClose(): void;
}): ReactElement {
  const row = thread.agents.find((a) => a.agentId === agentId) as ThreadAgentRow;
  const [value, setValue] = useState<AgentSettings>(settingsOf(row));
  const name = deps.nameOf(agentId);
  const lead = swapNeeded(thread, agentId);
  const change = (next: AgentSettings): void => {
    const textOnly = next.how === value.how && next.when === value.when && next.style === value.style;
    if (next.how === "lead" && value.how !== "lead" && lead) {
      const old = deps.nameOf(lead.agentId);
      confirm([
        { head: `${old} leads this chat. Make ${name} lead instead? ${old} will keep listening.` },
        { label: "Swap", onSelect: () => { setValue(next); save(thread.threadId, agentId, next, false); deps.toast(`${name} now answers everything. ${old} answers only when tagged.`); } },
        { label: "Cancel" },
      ], x, y, name);
      return;
    }
    setValue(next);
    save(thread.threadId, agentId, next, textOnly);
  };
  return (
    <AgentSettingsPopover
      name={name} face={<AccessFace kind="agent" id={agentId} name={name} size={26} />} value={value} outside={outside} anchor={{ x, y }}
      onChange={change} onPoke={() => poke(thread.threadId, agentId, thread.agents.map((a) => ({ id: a.agentId })))} onClose={onClose}
    />
  );
}


/** The picks a new chat's start could not take (outside agents, new agents, guests, more than one person): applied to the chat once it exists. An agent chat.start already added only gets its answers set. */
export async function runAfterStart(deps: AddSheetDeps, threadId: string, picks: readonly AccessPick[]): Promise<{ added: string[]; failed: string[] }> {
  const rest = picks.filter((p) => p.kind === "outside" || p.kind === "new" || p.kind === "guest");
  const people = picks.filter((p) => p.kind === "person").slice(1);
  const out = await runAdd(deps, { ctx: { kind: "chat", threadId }, target: { kind: "chat", name: "this chat", filesFolder: "", recordsFolder: "" }, threadId, directory: {}, here: [], agentSettings: {} }, [...people, ...rest]);
  for (const p of picks.filter((x) => x.kind === "agent" && x.settings !== undefined && (x.settings.how !== "tag" || x.settings.when !== "always" || x.settings.style !== "short"))) {
    try { await deps.call("threads.agent_settings.set", agentSettingsInput(threadId, p.id, p.settings as AgentSettings)); } catch { out.failed.push(p.name); }
  }
  return out;
}
