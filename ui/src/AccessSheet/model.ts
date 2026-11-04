// ui/AccessSheet model: everything the sheet decides, as pure functions (no React), so the words, the locks and the capability inputs are tested without drawing anything.
// The builders at the bottom return exactly the inputs of the capabilities the hosts call (CapMap[...]["in"]), so the sheet and the contract cannot drift.

import type { CapMap } from "../../../generated/types.ts";
import type { MenuEntry } from "../Menu/index.tsx";
import { DEFAULT_AGENT_SETTINGS } from "./props.ts";
import type {
  AccessDirectory,
  AccessEntry,
  AccessPick,
  AddTarget,
  AgentHow,
  AgentSettings,
  AgentStyle,
  AgentWhen,
  ShareInput,
  ShareItemType,
  ShareLevel,
  ShareResourceType,
  ShareSubjectKind,
  UnshareInput,
} from "./props.ts";

/* ---------- keys and small helpers ---------- */

export const entryKey = (kind: string, id: string): string => `${kind}:${id}`;
export const guestKey = (email: string): string => `guest:${email.trim().toLowerCase()}`;
const ek = (e: AccessEntry): string => entryKey(e.kind, e.id);

export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());
}

/** Fewer words for a chip or a button: a person's first name; an agent keeps its name. */
export function firstName(p: Pick<AccessPick, "kind" | "name">): string {
  return p.kind === "person" ? (p.name.split(" ")[0] ?? p.name) : p.name;
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const isAgentKind = (k: string): boolean => k === "agent" || k === "outside" || k === "new";

export const PHONE_WIDTH = 640;
/** Under 640 px the sheet is a bottom sheet and the main button is short. */
export const isPhoneWidth = (width: number): boolean => width > 0 && width < PHONE_WIDTH;

/* ---------- the share items ---------- */

export interface LevelDef {
  id: ShareLevel;
  label: string;
}

const L3: readonly LevelDef[] = [{ id: "view", label: "Can view" }, { id: "edit", label: "Can edit" }, { id: "manage", label: "Can manage" }];

export interface ItemDef {
  /** The item in a sentence. */
  label: string;
  levels: readonly LevelDef[];
  /** The level a pick starts at. */
  def: ShareLevel;
  /** The last line of what they get. */
  tail: string;
}

export const ITEM_DEFS: Readonly<Record<ShareItemType, ItemDef>> = {
  note: { label: "note", levels: L3, def: "view", tail: "They see its history from now on." },
  file: { label: "folder", levels: L3, def: "view", tail: "Everything inside comes with it, including new files." },
  record: { label: "record", levels: L3, def: "view", tail: "They see this record's fields, not the rest of the table." },
  rtype: {
    label: "record type",
    levels: [{ id: "view", label: "Can view records" }, { id: "edit", label: "Can edit records" }, { id: "manage", label: "Can manage the type" }],
    def: "view",
    tail: "Every record of this type, and its fields.",
  },
  artifact: { label: "artifact", levels: L3, def: "view", tail: "They see the latest version and its comments." },
  project: { label: "project", levels: L3, def: "view", tail: "They see the project's chats, files folder and records." },
  automation: { label: "automation", levels: L3, def: "view", tail: "View sees it, its runs and its history. Edit changes and pauses it. Manage also shares and deletes it." },
  vault: {
    label: "Vault item",
    levels: [{ id: "use", label: "Can use without seeing" }, { id: "view", label: "Can see" }, { id: "edit", label: "Can edit" }, { id: "manage", label: "Can manage" }],
    def: "use",
    tail: "The value is never shown or sent in chat to anyone who can only use it.",
  },
  agent: {
    label: "agent",
    levels: [{ id: "use", label: "Can use" }, { id: "edit", label: "Can edit" }, { id: "manage", label: "Can manage" }],
    def: "use",
    tail: "",
  },
};

const ORDER: readonly ShareLevel[] = ["view", "use", "edit", "manage"];

/** The levels this item offers: the type's own list, narrowed to the ones the host passes. Always at least the first. */
export function levelDefs(type: ShareItemType, offered?: readonly ShareLevel[]): LevelDef[] {
  const all = ITEM_DEFS[type].levels;
  if (offered === undefined) return all.slice();
  const some = all.filter((l) => offered.includes(l.id));
  return some.length > 0 ? some : [all[0] as LevelDef];
}

export function levelName(type: ShareItemType, level: ShareLevel | "owner"): string {
  if (level === "owner") return "Owner";
  return ITEM_DEFS[type].levels.find((l) => l.id === level)?.label ?? `Can ${level}`;
}

/** How high a level is for this item (the Vault's lowest is Can use without seeing). */
export function levelRank(type: ShareItemType, level: ShareLevel): number {
  const own = ITEM_DEFS[type].levels.findIndex((l) => l.id === level);
  return own >= 0 ? own : ORDER.indexOf(level);
}

export interface Giving {
  maxLevel?: ShareLevel | undefined;
  canGive?: ((level: ShareLevel) => boolean) | undefined;
}

/** A person can only give what they have: canGive decides when it is passed, else maxLevel caps the item's levels. */
export function canGiveLevel(type: ShareItemType, level: ShareLevel, g: Giving): boolean {
  if (g.canGive !== undefined) return g.canGive(level);
  if (g.maxLevel === undefined) return true;
  return levelRank(type, level) <= levelRank(type, g.maxLevel);
}

/** The most that is given when the person holds only the lowest level (they can view here, so add viewers only). */
export function isViewOnly(g: Giving): boolean {
  if (g.canGive !== undefined) return !g.canGive("edit") && !g.canGive("manage");
  return g.maxLevel === "view";
}

export const LOCKED_NOTE = " (you do not have this)";
export const VIEW_ONLY_NOTE = "You can view here, so you can add people as viewers only. A person can give only what they have.";

/* ---------- what they get: share ---------- */

/** "view and edit “Q4 invoices”": what the level lets them do, to finish "Sara can ...". */
export function shareVerb(type: ShareItemType, level: ShareLevel, name: string): string {
  if (type === "agent") {
    if (level === "view" || level === "use") return `use ${name} in their chats, tasks and automations`;
    if (level === "edit") return `change ${name}'s instructions, context and tools`;
    return `share, move and delete ${name}`;
  }
  const q = `“${name}”`;
  if (type === "vault" && level === "use") return `use ${q} in actions without seeing its value`;
  if (level === "edit") return `view and edit ${q}`;
  if (level === "manage") return `view, edit and share ${q}`;
  return `view ${q}`;
}

export interface Line {
  id: string;
  tone: "plain" | "note" | "lock";
  text: string;
}

export function sharedBy(type: ShareItemType, name: string, who: readonly string[] = []): string {
  void type;
  if (who.length === 0) return `Whoever uses ${name} pays with their own AI account, and ${name} only sees what they can see.`;
  const them = who.length === 1 ? `${who[0]}'s` : "their";
  const subject = who.length === 1 ? (who[0] as string) : joinNames(who);
  return `${subject} ${who.length === 1 ? "pays" : "pay"} with ${them} own AI account, and ${name} only sees what ${subject} can see.`;
}

/** The footer of an agent share with nobody picked: the four levels. */
export function agentLevelsLine(name: string): string {
  return `Can use: chat with ${name} and put it to work in your own chats, tasks, automations and crews, on your own AI account. Can edit: change its instructions, context and tools. Can manage: share it, move it and delete it.`;
}

export interface ShareLinesInput {
  type: ShareItemType;
  name: string;
  /** The item in a sentence; default by type. */
  label?: string | undefined;
  picks: readonly AccessPick[];
  ownerName: string;
  limited?: boolean;
}

/** What they get, per level, then guests, outside agents, the Space and the tail. Empty with nothing picked (except the agent's four levels, which the sheet shows). */
export function shareLines(i: ShareLinesInput): Line[] {
  const def = ITEM_DEFS[i.type];
  const label = i.label ?? def.label;
  const out: Line[] = [];
  const P = i.picks;
  // nothing picked: no legend. Each level says what it gives inside its own picker menu (levelHint)
  if (P.length === 0) return [];
  const levels = levelDefs(i.type).map((l) => l.id);
  for (const lv of levels) {
    const names = P.filter((p) => p.role === lv && p.kind !== "guest" && p.kind !== "outside" && p.kind !== "agent" && p.kind !== "new" && p.kind !== "space").map((p) => p.name);
    if (names.length > 0) {
      const text = i.type === "agent" && (lv === "use" || lv === "view")
        ? `${joinNames(names)} can use ${i.name} in ${possessiveOf(names)} chats, tasks and automations.`
        : `${joinNames(names)} can ${shareVerb(i.type, lv, i.name)}.`;
      out.push({ id: `lv-${lv}`, tone: "plain", text });
    }
    if (P.some((p) => p.kind === "space" && p.role === lv)) out.push({ id: `space-${lv}`, tone: "plain", text: `Anyone in the Space can ${shareVerb(i.type, lv, i.name)}.` });
  }
  const guests = P.filter((p) => p.kind === "guest");
  if (guests.length > 0) out.push({ id: "guests", tone: "plain", text: `${joinNames(guests.map((g) => g.name))} ${guests.length === 1 ? "sees" : "see"} only this ${label}, never what is around it.` });
  for (const o of P.filter((p) => p.kind === "outside")) {
    out.push({ id: `out-${o.id}`, tone: "lock", text: `${o.name} reaches it through MCP tools scoped to exactly this ${label}, never wider. It shows as ${i.ownerName} (Agent), is audited, and removing it ends access at once.` });
  }
  if (P.some((p) => p.kind === "space")) out.push({ id: "space", tone: "note", text: "Anyone in the Space can find it from search." });
  if (i.type === "agent") {
    const people = P.filter((p) => p.kind === "person" || p.kind === "group" || p.kind === "role").map((p) => p.name);
    out.push({ id: "pays", tone: "note", text: sharedBy(i.type, i.name, people) });
  }
  const tail = `${def.tail}${i.limited === true ? " You can give only what you have yourself." : ""}`.trim();
  if (tail !== "") out.push({ id: "tail", tone: "note", text: tail });
  return out;
}

/* ---------- what they get: add ---------- */

const NOUN: Readonly<Record<AddTarget["kind"], { noun: string; own: string }>> = {
  chat: { noun: "this chat", own: "the chat" },
  channel: { noun: "this channel", own: "the channel" },
  thread: { noun: "this thread", own: "the thread" },
  project: { noun: "this project", own: "the project" },
};

export const targetNoun = (kind: AddTarget["kind"]): string => NOUN[kind].noun;
export const targetOwn = (kind: AddTarget["kind"]): string => NOUN[kind].own;

export interface AddLinesInput {
  target: AddTarget;
  picks: readonly AccessPick[];
  earlier: boolean;
  ownerName: string;
  limited?: boolean;
}

export function addLines(i: AddLinesInput): Line[] {
  const P = i.picks;
  const out: Line[] = [];
  if (P.length === 0) return out;
  const t = i.target;
  const noun = targetNoun(t.kind);
  const std = P.filter((p) => p.kind !== "guest");
  const guests = P.filter((p) => p.kind === "guest");
  if (std.length > 0) out.push({ id: "std", tone: "plain", text: i.earlier ? `They'll see the whole ${noun.replace(/^this /, "")}, its files folder ${t.filesFolder}, and records in ${t.recordsFolder}.` : `They'll see ${noun}'s messages from now on, its files folder ${t.filesFolder}, and records in ${t.recordsFolder}.` });
  if (guests.length > 0) out.push({ id: "guests", tone: "plain", text: `${joinNames(guests.map((g) => g.name))} ${guests.length === 1 ? "sees" : "see"} only what ${noun} allows: messages from now on, no files folder, no records.` });
  for (const o of P.filter((p) => p.kind === "outside")) {
    const reads = t.kind === "project" ? "the project's context and folders" : "its folder and the records folder";
    out.push({ id: `out-${o.id}`, tone: "lock", text: `${o.name} reads and posts in ${noun} and reads ${reads}, through MCP tools scoped to exactly these, never wider. It shows as ${i.ownerName} (Agent), is audited, and removing it ends access at once.` });
  }
  const made = P.filter((p) => p.kind === "new");
  if (made.length > 0) out.push({ id: "new", tone: "note", text: `${joinNames(made.map((n) => n.name))} ${made.length === 1 ? "belongs" : "belong"} to ${targetOwn(t.kind)} and ${made.length === 1 ? "is" : "are"} removed with it.` });
  if (i.limited === true) out.push({ id: "limited", tone: "note", text: VIEW_ONLY_NOTE });
  return out;
}

/** The footer when nothing is picked. */
export function idleLine(mode: "add" | "share", type?: ShareItemType, name?: string): string {
  void type; void name;
  return mode === "add" ? "Pick who to add. You will see what they get before you confirm." : "";
}

/** Whether the "Include earlier messages" switch shows: a person, not a guest, is picked. */
export function showsEarlier(picks: readonly AccessPick[]): boolean {
  return picks.some((p) => p.kind === "person");
}

/* ---------- the main button ---------- */

/** "Add", "Add Sara", "Add Sara and Docs", "Add 3 people and agents"; on a phone "Add 3". Share says "Share with ...". */
export function actionLabel(mode: "add" | "share", picks: readonly AccessPick[], compact: boolean): string {
  const verb = mode === "add" ? "Add" : "Share";
  const joiner = mode === "add" ? verb : `${verb} with`;
  const n = picks.length;
  if (n === 0) return verb;
  if (n === 1) return `${joiner} ${firstName(picks[0] as AccessPick)}`;
  if (compact) return `${verb} ${n}`;
  if (n === 2) return `${joiner} ${firstName(picks[0] as AccessPick)} and ${firstName(picks[1] as AccessPick)}`;
  return mode === "add" ? `Add ${n} people and agents` : `Share with ${n}`;
}

/* ---------- roles ---------- */

export interface RoleOption {
  id: string;
  label: string;
  locked: boolean;
}

const ADD_ROLES: Readonly<Record<"person" | "guest", readonly { id: string; label: string }[]>> = {
  person: [{ id: "member", label: "Member" }, { id: "view", label: "Can view" }],
  guest: [{ id: "gview", label: "Can view" }, { id: "greply", label: "Can reply" }],
};

export interface RoleContext {
  mode: "add" | "share";
  itemType?: ShareItemType | undefined;
  offered?: readonly ShareLevel[] | undefined;
  giving?: Giving;
  /** Share mode: the level Everyone already holds. A new person starts one level above it. */
  general?: ShareLevel | null | undefined;
}

/** The roles a pick can take. Locked ones stay in the list, greyed. Agents have no role list: they open the settings popover. */
export function roleOptions(kind: AccessPick["kind"], c: RoleContext): RoleOption[] {
  if (isAgentKind(kind)) return [];
  const g = c.giving ?? {};
  if (c.mode === "add") {
    if (kind === "guest") return ADD_ROLES.guest.map((r) => ({ ...r, locked: false }));
    return ADD_ROLES.person.filter((r) => !(r.id === "member" && isViewOnly(g))).map((r) => ({ ...r, locked: false }));
  }
  const type = c.itemType ?? "note";
  const defs = levelDefs(type, c.offered);
  const list = kind === "guest" ? defs.slice(0, 1) : defs;
  // a level above the giver's own is not offered at all (owner, 4 Nov: hide, never disable)
  return list.filter((l) => canGiveLevel(type, l.id, g)).map((l) => ({ id: l.id, label: l.label, locked: false }));
}

export function roleLabel(o: RoleOption): string {
  return o.locked ? `${o.label}${LOCKED_NOTE}` : o.label;
}

export function roleName(kind: AccessPick["kind"], role: string, c: RoleContext): string {
  return roleOptions(kind, c).find((o) => o.id === role)?.label ?? role;
}

/** The role a new pick starts at: add mode, Member (or Can view when the person can only view); a guest Can view; share mode, the level above the general one, else the item's default. */
export function defaultRole(kind: AccessPick["kind"], c: RoleContext): string {
  if (isAgentKind(kind)) return "";
  const g = c.giving ?? {};
  if (c.mode === "add") return kind === "guest" ? "gview" : isViewOnly(g) ? "view" : "member";
  const defs = levelDefs(c.itemType ?? "note", c.offered);
  const want = ITEM_DEFS[c.itemType ?? "note"].def;
  // a new person starts one level above what Everyone already holds, so the grant adds something (owner, 4 Nov); with nothing general, the item's own default
  const at = c.general ? defs.findIndex((l) => l.id === c.general) : -1;
  const above = at >= 0 ? defs.slice(at + 1).find((l) => canGiveLevel(c.itemType ?? "note", l.id, g)) : undefined;
  const first = above ?? defs.find((l) => l.id === want) ?? (defs[0] as LevelDef);
  return first.id;
}

/* ---------- picks ---------- */

export function pickFromEntry(e: AccessEntry, c: RoleContext): AccessPick {
  const kind: AccessPick["kind"] = e.kind;
  const sub = e.sub ?? (e.assistant === true ? "Yours, private to you" : undefined);
  return {
    key: ek(e),
    kind,
    id: e.id,
    name: e.assistant === true ? "Assistant" : e.name,
    ...(sub === undefined ? {} : { sub }),
    ...(e.assistant === true ? { assistant: true } : {}),
    role: defaultRole(kind, c),
    ...(c.mode === "add" && isAgentKind(kind) ? { settings: { ...DEFAULT_AGENT_SETTINGS } } : {}),
    ...(e.subject === undefined ? {} : { subject: e.subject }),
  };
}

export function pickFromEmail(email: string, c: RoleContext): AccessPick {
  const mail = email.trim();
  return { key: guestKey(mail), kind: "guest", id: mail, name: mail, email: mail, sub: "Guest, by email", role: defaultRole("guest", c) };
}

export interface NewAgentDraft {
  name: string;
  brief: string;
  model: string;
}

export function pickFromNew(n: number, d: NewAgentDraft): AccessPick {
  const brief = d.brief.trim();
  return {
    key: entryKey("new", String(n)),
    kind: "new",
    id: String(n),
    name: d.name.trim(),
    sub: `New · ${d.model}`,
    role: "",
    settings: { ...DEFAULT_AGENT_SETTINGS },
    ...(brief === "" ? {} : { brief }),
    model: d.model,
  };
}

export function canCreateAgent(d: NewAgentDraft): boolean {
  return d.name.trim() !== "";
}

/* ---------- the lists ---------- */

export interface Sections {
  suggested: AccessEntry[];
  people: AccessEntry[];
  groups: AccessEntry[];
  space: AccessEntry | null;
  agents: AccessEntry[];
  outside: AccessEntry[];
  /** The address typed, when the text is one and it is not picked yet. */
  invite: string | null;
}

export interface SectionsInput {
  directory: AccessDirectory;
  query: string;
  mode: "add" | "share";
  itemType?: ShareItemType | undefined;
  /** Keys that are already in (Here now, Who has access) or picked. */
  taken: ReadonlySet<string>;
}

export function sections(i: SectionsInput): Sections {
  const q = i.query.trim().toLowerCase();
  const d = i.directory;
  const agentShare = i.mode === "share" && i.itemType === "agent";
  const fits = (e: AccessEntry): boolean => !i.taken.has(ek(e)) && (q === "" || e.name.toLowerCase().includes(q));
  // sharing an agent goes to people and groups only
  const allowed = (e: AccessEntry): boolean => !(agentShare && (e.kind === "agent" || e.kind === "outside"));
  const first = q === "" ? (d.suggested ?? []).filter((e) => fits(e) && allowed(e)) : [];
  // Share mode with nothing typed: one short Suggested list (five rows at most) of people, then groups and agents; typing searches everything
  const pool = i.mode === "share" && q === "" ? [...first, ...(d.people ?? []), ...(d.groups ?? []), ...(i.itemType === "agent" ? [] : d.agents ?? [])].filter((e) => fits(e) && allowed(e)) : first;
  const dedup = [...new Map(pool.map((e) => [ek(e), e] as const)).values()];
  const suggested = i.mode === "share" && q === "" ? dedup.slice(0, 5) : first;
  const seen = new Set(suggested.map(ek));
  const rest = (list: readonly AccessEntry[] | undefined): AccessEntry[] => (list ?? []).filter((e) => fits(e) && allowed(e) && !seen.has(ek(e)));
  const invite = q !== "" && isEmail(i.query) && !i.taken.has(guestKey(i.query)) ? i.query.trim() : null;
  return {
    suggested,
    people: i.mode === "share" && q === "" ? [] : rest(d.people),
    groups: i.mode === "share" ? (q === "" ? [] : rest(d.groups)) : [],
    // the General access row at the top is the Space; it is found by typing, not listed a second time
    space: i.mode === "share" && q !== "" && d.space !== undefined && fits(d.space) && allowed(d.space) ? d.space : null,
    agents: agentShare || (i.mode === "share" && q === "") ? [] : rest(d.agents),
    outside: agentShare ? [] : rest(d.outside),
    invite,
  };
}

/** What Enter adds: the address, then the first row in the order the sheet draws them. */
export function topMatch(s: Sections): { entry: AccessEntry } | { invite: string } | null {
  if (s.invite !== null) return { invite: s.invite };
  const first = s.suggested[0] ?? s.space ?? s.people[0] ?? s.groups[0] ?? s.agents[0] ?? s.outside[0];
  return first === undefined ? null : { entry: first };
}

export function noMatch(s: Sections, query: string): boolean {
  return query.trim() !== "" && s.invite === null && s.suggested.length + s.people.length + s.groups.length + s.agents.length + s.outside.length === 0 && s.space === null;
}

/* ---------- how an agent answers ---------- */

export const HOW_OPTIONS: readonly { id: AgentHow; label: string; hint: string }[] = [
  { id: "lead", label: "Answers everything", hint: "Replies to every message. It is the lead here." },
  { id: "tag", label: "Answers when mentioned", hint: "Replies when you @mention it. The default." },
  { id: "listen", label: "Only listens", hint: "Reads the chat and never posts unless poked." },
];
export const WHEN_OPTIONS: readonly { id: AgentWhen; label: string; hint: string }[] = [
  { id: "always", label: "Any time", hint: "Answers whenever it would otherwise." },
  { id: "topics", label: "Only about certain topics", hint: "Answers only messages about the topics you list." },
  { id: "hours", label: "Only during working hours", hint: "Answers only between the times you set." },
];
export const STYLE_OPTIONS: readonly { id: AgentStyle; label: string; hint: string }[] = [
  { id: "short", label: "Short replies", hint: "Keeps answers brief." },
  { id: "full", label: "Full detail", hint: "Gives the whole answer." },
];
export const TOPICS_PLACEHOLDER = "A few words, for example invoices, billing";

/** An outside agent cannot be the lead of a chat from the sheet: it answers when mentioned or listens. */
export function howOptions(outside: boolean): readonly { id: AgentHow; label: string; hint: string }[] {
  return outside ? HOW_OPTIONS.filter((h) => h.id !== "lead") : HOW_OPTIONS;
}

export function pokeNote(name: string): string {
  return `Poke asks ${name} to read the chat now and reply. It only sees what you can see.`;
}

export function settingsSummary(s: AgentSettings): string {
  const how = HOW_OPTIONS.find((h) => h.id === s.how)?.label ?? "";
  const when = s.when === "topics" ? `Only on ${s.topics.trim() === "" ? "topics" : s.topics.trim()}` : s.when === "hours" ? `${s.hoursFrom} to ${s.hoursTo}` : "Any time";
  return `${how} · ${when} · ${STYLE_OPTIONS.find((o) => o.id === s.style)?.label ?? ""}`;
}

export function outsideSub(name: string, ownerName: string): string {
  return `${name} · shows as ${ownerName} (Agent)`;
}

export const OUTSIDE_NOTE = (ownerName: string): string => `Others see these as ${ownerName} (Agent)`;
export const NO_OUTSIDE = "No outside agent connected yet.";
export const NO_MATCH = "Nobody by that name. Type an email to invite a guest.";

/* ---------- capability inputs: add mode ---------- */

type In<K extends keyof CapMap> = CapMap[K]["in"];

/** Answers everything = lead; Answers when mentioned = listen; Listening = quiet (reads, posts only when poked). */
export function modeOf(how: AgentHow): "lead" | "listen" | "quiet" {
  return how === "lead" ? "lead" : how === "tag" ? "listen" : "quiet";
}

export function addAgentInput(threadId: string, agentId: string, how: AgentHow = "tag"): In<"threads.add_agent"> {
  // threads.add_agent takes lead or listen; a Listening agent is added as listen and set quiet right after (agentSettingsInput)
  return { threadId, agentId, mode: how === "lead" ? "lead" : "listen" };
}

export function agentCreateInput(threadId: string, d: { name: string; brief?: string | undefined; model?: string | undefined; how?: AgentHow | undefined }, idempotencyKey: string): In<"threads.agent.create"> {
  const brief = d.brief?.trim();
  return {
    threadId,
    name: d.name.trim(),
    ...(brief === undefined || brief === "" ? {} : { brief }),
    ...(d.model === undefined || d.model === "" ? {} : { model: d.model }),
    ...(d.how === undefined ? {} : { mode: modeOf(d.how) }),
    idempotencyKey,
  };
}

/** Settings for one agent in one chat: mode from How, and the hours and topics only when When asks for them (else cleared). */
export function agentSettingsInput(threadId: string, agentId: string, s: Partial<AgentSettings>): In<"threads.agent_settings.set"> {
  const topics = s.topics?.trim();
  return {
    threadId,
    agentId,
    ...(s.how === undefined ? {} : { mode: modeOf(s.how) }),
    ...(s.when === undefined ? {} : { when: s.when }),
    ...(s.when === undefined ? {} : { topics: s.when === "topics" && topics !== undefined && topics !== "" ? topics : null }),
    ...(s.when === undefined ? {} : { hoursFrom: s.when === "hours" ? (s.hoursFrom ?? null) : null, hoursTo: s.when === "hours" ? (s.hoursTo ?? null) : null }),
    ...(s.style === undefined ? {} : { style: s.style }),
  };
}

export function pokeInput(threadId: string, agentId: string, note?: string): In<"threads.poke"> {
  const n = note?.trim();
  return { threadId, agentId, ...(n === undefined || n === "" ? {} : { note: n }) };
}

export function outsideAgentAddInput(threadId: string, agentId: string, how?: AgentHow): In<"threads.outside_agent.add"> {
  return { threadId, agentId, ...(how === undefined ? {} : { mode: modeOf(how) }) };
}

export function outsideAgentRemoveInput(threadId: string, agentId: string): In<"threads.outside_agent.remove"> {
  return { threadId, agentId };
}

/** gview = Can view; greply = Can reply. */
export function inviteGuestInput(threadId: string, email: string, role: "gview" | "greply" | string, idempotencyKey: string): In<"threads.invite_guest"> {
  return { threadId, email: email.trim(), level: role === "greply" ? "reply" : "view", idempotencyKey };
}

/** "Include earlier messages" is fromStart: the newcomer reads the chat from the start. Left out, a private chat shows them messages from now on. */
export function threadMemberInput(threadId: string, personId: string, fromStart = false): In<"threads.members.add"> {
  return { threadId, personId, ...(fromStart ? { fromStart: true } : {}) };
}

/** Member is use; Can view is view. */
export function channelMembersInput(channelId: string, personIds: readonly string[], role: "member" | "view" | string = "member"): In<"channels.members.add"> {
  return { channelId, personIds: personIds.slice(), level: role === "view" ? "view" : "use" };
}

/** A project has the roles lead, member, reviewer and guest: Member is member; Can view is guest. */
export function projectMemberInput(projectId: string, principal: string, role: "member" | "view" | string, idempotencyKey: string): In<"projects.members.set"> {
  return { projectId, principal, role: role === "view" ? "guest" : "member", idempotencyKey };
}

export type AddCap =
  | "threads.members.add"
  | "threads.add_agent"
  | "threads.agent.create"
  | "threads.agent_settings.set"
  | "threads.outside_agent.add"
  | "threads.invite_guest"
  | "channels.members.add"
  | "projects.members.set";

export type AddCall = { [K in AddCap]: { cap: K; input: In<K> } }[AddCap];

export type AddContext =
  | { kind: "chat" | "thread"; threadId: string }
  /** A channel: people join the channel; agents, outside agents, guests and new agents act on its main chat. */
  | { kind: "channel"; channelId: string; mainThreadId: string }
  /** A project: people and agents are members; outside agents, guests and new agents belong to a chat, so the host makes them in the project's chat. */
  | { kind: "project"; projectId: string };

export interface AddPlan {
  calls: AddCall[];
  /** Picks that this target cannot take (a guest on a project); the host decides what to do with them. */
  unsupported: AccessPick[];
}

const isDefaultSettings = (s: AgentSettings): boolean =>
  s.how === DEFAULT_AGENT_SETTINGS.how && s.when === DEFAULT_AGENT_SETTINGS.when && s.style === DEFAULT_AGENT_SETTINGS.style;

/** The capability calls for the picks, in order. People first (a channel's people in one call, grouped by role), then agents, outside agents, new agents, guests; settings follow any agent whose answers differ from the default. */
export function addCalls(ctx: AddContext, picks: readonly AccessPick[], newKey: (p: AccessPick) => string, opts: { earlier?: boolean } = {}): AddPlan {
  const calls: AddCall[] = [];
  const unsupported: AccessPick[] = [];
  const threadId = ctx.kind === "channel" ? ctx.mainThreadId : ctx.kind === "project" ? "" : ctx.threadId;
  const settingsFor = (p: AccessPick): void => {
    const s = p.settings;
    if (s !== undefined && !isDefaultSettings(s) && threadId !== "") calls.push({ cap: "threads.agent_settings.set", input: agentSettingsInput(threadId, p.id, s) });
  };
  if (ctx.kind === "channel") {
    for (const role of ["member", "view"]) {
      const ids = picks.filter((p) => p.kind === "person" && p.role === role).map((p) => p.id);
      if (ids.length > 0) calls.push({ cap: "channels.members.add", input: channelMembersInput(ctx.channelId, ids, role) });
    }
  }
  for (const p of picks) {
    if (p.kind === "person") {
      if (ctx.kind === "chat" || ctx.kind === "thread") calls.push({ cap: "threads.members.add", input: threadMemberInput(ctx.threadId, p.id, opts.earlier === true) });
      else if (ctx.kind === "project") calls.push({ cap: "projects.members.set", input: projectMemberInput(ctx.projectId, p.id, p.role, newKey(p)) });
    } else if (p.kind === "agent") {
      if (ctx.kind === "project") calls.push({ cap: "projects.members.set", input: projectMemberInput(ctx.projectId, p.id, "member", newKey(p)) });
      else {
        calls.push({ cap: "threads.add_agent", input: addAgentInput(threadId, p.id, p.settings?.how) });
        settingsFor(p);
      }
    } else if (p.kind === "outside") {
      if (ctx.kind === "project") unsupported.push(p);
      else {
        calls.push({ cap: "threads.outside_agent.add", input: outsideAgentAddInput(threadId, p.id, p.settings?.how) });
        settingsFor(p);
      }
    } else if (p.kind === "new") {
      if (ctx.kind === "project") unsupported.push(p);
      else calls.push({ cap: "threads.agent.create", input: agentCreateInput(threadId, { name: p.name, brief: p.brief, model: p.model, how: p.settings?.how }, newKey(p)) });
    } else if (p.kind === "guest") {
      if (ctx.kind === "project" || p.email === undefined) unsupported.push(p);
      else calls.push({ cap: "threads.invite_guest", input: inviteGuestInput(threadId, p.email, p.role, newKey(p)) });
    } else unsupported.push(p);
  }
  return { calls, unsupported };
}

/* ---------- capability inputs: share mode (the same helpers the old ShareSheet had) ---------- */

export const SHARE_CAPABILITY = "access.share" as const;
export const UNSHARE_CAPABILITY = "access.unshare" as const;
/** The link row's subject id: the server makes the link and returns its own id. */
export const LINK_SUBJECT_ID = "public";

/** A link grant is view only, whatever level was asked for. */
export function effectiveLevel(kind: ShareSubjectKind, level: ShareLevel): ShareLevel {
  return kind === "link" ? "view" : level;
}

export interface ShareRes {
  resourceType: ShareResourceType;
  resourceId: string;
}

export function shareInput(res: ShareRes, subject: { kind: ShareSubjectKind; id: string }, level: ShareLevel, idempotencyKey: string): ShareInput & { idempotencyKey: string };
export function shareInput(res: ShareRes, subject: { kind: ShareSubjectKind; id: string }, level: ShareLevel, idempotencyKey?: string): ShareInput;
export function shareInput(res: ShareRes, subject: { kind: ShareSubjectKind; id: string }, level: ShareLevel, idempotencyKey?: string): ShareInput {
  return { resource: { type: res.resourceType, id: res.resourceId }, subject: { kind: subject.kind, id: subject.id }, level: effectiveLevel(subject.kind, level), ...(idempotencyKey === undefined ? {} : { idempotencyKey }) };
}

export function unshareInput(res: ShareRes, subject: { kind: ShareSubjectKind; id: string }): UnshareInput {
  return { resource: { type: res.resourceType, id: res.resourceId }, subject: { kind: subject.kind, id: subject.id } };
}

/** The subject a share pick grants: the entry's own override, else its kind (an outside agent is an agent). */
export function subjectOfPick(p: Pick<AccessPick, "kind" | "id" | "subject">): { kind: "person" | "agent" | "group" | "role"; id: string } {
  if (p.subject !== undefined) return p.subject;
  const kind = p.kind === "person" || p.kind === "group" || p.kind === "role" ? p.kind : p.kind === "space" ? "group" : "agent";
  return { kind, id: p.id };
}

/** The access.share inputs for share-mode picks; guests are left out (they are invited by email). */
export function shareCalls(res: ShareRes, picks: readonly AccessPick[], newKey?: () => string): ShareInput[] {
  const out: ShareInput[] = [];
  for (const p of picks) {
    if (p.kind === "guest" || p.kind === "new") continue;
    out.push(shareInput(res, subjectOfPick(p), p.role as ShareLevel, newKey?.()));
  }
  return out;
}

/* ---------- the access list (ported from the old share sheet) ---------- */

export interface AccessRowLike {
  subjectKind: ShareSubjectKind;
  level: ShareLevel;
  via: "owner" | "grant" | "folder" | "space";
  name: string;
}

/** Levels a row may take: the item's levels; an inherited row can only be raised from where it is. A link is view only. */
export function levelsFor(row: Pick<AccessRowLike, "subjectKind" | "level" | "via">, type: ShareItemType, offered?: readonly ShareLevel[]): ShareLevel[] {
  const defs = levelDefs(type, offered).map((l) => l.id);
  if (row.subjectKind === "link") return defs.includes("view") ? ["view"] : [];
  const floor = row.via === "folder" || row.via === "space" ? levelRank(type, row.level) : 0;
  return defs.filter((l) => levelRank(type, l) >= floor);
}

/** Inherited and owner rows have no remove button. */
export function removable(row: Pick<AccessRowLike, "via">): boolean {
  return row.via === "grant";
}

/** Rows in the order the sheet shows them: what this item grants, most access first, then what comes from the folder. */
export function sheetRows<R extends AccessRowLike>(shares: readonly R[], type: ShareItemType = "note"): { direct: R[]; inherited: R[]; link: R | null } {
  const byAccess = (a: R, b: R): number => levelRank(type, b.level) - levelRank(type, a.level) || a.name.localeCompare(b.name);
  const link = shares.find((r) => r.subjectKind === "link") ?? null;
  const people = shares.filter((r) => r.subjectKind !== "link");
  return {
    direct: people.filter((r) => r.via === "grant").sort(byAccess),
    inherited: people.filter((r) => r.via === "folder" || r.via === "space").sort(byAccess),
    link,
  };
}

export function rowSub(row: { subjectKind: ShareSubjectKind; via: string }, folderName?: string): string {
  // never "Not in a folder" above "From the folder": with no folder named, what is inherited comes from the Space
  if (row.via === "folder") return folderName ? `From the folder ${folderName}` : "From the Space";
  if (row.via === "space") return "From the Space";
  // a person has no label under their name (their title or email, when the host has one); a group, role or agent says what it is
  return ({ person: "", group: "Team", role: "Role", agent: "Agent", link: "Link" } as Record<ShareSubjectKind, string>)[row.subjectKind];
}

export function accessSubtitle(type: ShareItemType, count: number, label?: string): string {
  const l = label ?? ITEM_DEFS[type].label;
  return `${l.charAt(0).toUpperCase()}${l.slice(1)} · ${count} with access`;
}

export const ASSISTANT_NOTICE = [
  "Your Assistant can't be shared. It holds your sign-ins, your memory and what you ask it, and only you see those.",
  "To give others an agent like it, make a new agent for the Space and share that one.",
] as const;

/** 24 hour clock text, for the hours fields. */
export function validTime(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text.trim());
}

/** Keys of directory entries that already hold a row of the access list, in the entries' own key form. */
export function takenFromRows(directory: AccessDirectory, rows: readonly { subjectKind: string; subjectId: string }[]): Set<string> {
  const have = new Set(rows.map((r) => `${r.subjectKind}:${r.subjectId}`));
  const out = new Set<string>();
  const lists = [directory.suggested, directory.people, directory.agents, directory.outside, directory.groups, directory.space === undefined ? undefined : [directory.space]];
  for (const list of lists) {
    for (const e of list ?? []) {
      const s = subjectOfPick({ kind: e.kind, id: e.id, ...(e.subject === undefined ? {} : { subject: e.subject }) });
      if (have.has(`${s.kind}:${s.id}`)) out.add(ek(e));
    }
  }
  return out;
}

/* ---------- the access view: one deduped list for the sheet and for the count behind it ---------- */

export const EVERYONE_IDS: readonly string[] = ["grp_everyone", "space"];

export interface AccessViewInput {
  shares: readonly ShareRow[];
  itemType: ShareItemType;
  /** The item's own id: an item never lists itself. */
  resourceId: string;
  ownerId?: string | undefined;
  ownerName: string;
  folderName?: string | undefined;
  /** The server's answer to "agents in the Space can call this", when it gives one. */
  agentsOn?: boolean | undefined;
}

export interface AccessView {
  owner: { id: string | null; name: string };
  /** "Everyone in the Space": the level, or null for No access. `row` is the grant behind it. */
  general: { level: ShareLevel | null; row: ShareRow | null };
  /** People, groups and roles, each once at their highest level, the owner and the Space left out. */
  people: ShareRow[];
  /** Agents: the Space line (on when agents in the Space hold access) and only the ones added on purpose. */
  agents: { on: boolean; inherited: boolean; specific: ShareRow[] };
  link: ShareRow | null;
  /** Where inherited rows come from. */
  inheritedFrom: string;
  /** The owner, the people, the groups and roles, the agents added on purpose, and the Space when it holds access. The same number is behind the sheet. */
  count: number;
  /** Nobody but the owner, and nothing general. */
  empty: boolean;
}

const VIA_RANK: Record<ShareRow["via"], number> = { owner: 3, grant: 2, folder: 1, space: 0 };

export const isEveryoneRow = (r: Pick<ShareRow, "subjectKind" | "subjectId">): boolean => r.subjectKind === "group" && EVERYONE_IDS.includes(r.subjectId);

/** Merge the same subject into one row at its highest level; at the same level the direct grant wins, so it can be removed. */
function onePerSubject(type: ShareItemType, rows: readonly ShareRow[]): ShareRow[] {
  const best = new Map<string, ShareRow>();
  for (const r of rows) {
    const key = `${r.subjectKind}:${r.subjectId}`;
    const have = best.get(key);
    if (!have) { best.set(key, r); continue; }
    const d = levelRank(type, r.level) - levelRank(type, have.level);
    if (d > 0 || (d === 0 && VIA_RANK[r.via] > VIA_RANK[have.via])) best.set(key, r);
  }
  return [...best.values()];
}

export function accessView(i: AccessViewInput): AccessView {
  const byAccess = (a: ShareRow, b: ShareRow): number => levelRank(i.itemType, b.level) - levelRank(i.itemType, a.level) || a.name.localeCompare(b.name);
  const rows = i.shares.filter((r) => {
    if (r.subjectKind === "agent" && (r.subjectId === i.resourceId || r.privateAgent === true)) return false;
    if (i.ownerId !== undefined && r.subjectKind === "person" && r.subjectId === i.ownerId) return false;
    return r.via !== "owner";
  });
  const merged = onePerSubject(i.itemType, rows);
  const link = merged.find((r) => r.subjectKind === "link") ?? null;
  const everyone = merged.find(isEveryoneRow) ?? null;
  const people = merged.filter((r) => (r.subjectKind === "person" || r.subjectKind === "group" || r.subjectKind === "role") && !isEveryoneRow(r)).sort(byAccess);
  const agentRows = merged.filter((r) => r.subjectKind === "agent").sort(byAccess);
  const specific = agentRows.filter((r) => r.via === "grant");
  const inherited = agentRows.some((r) => r.via !== "grant");
  const count = 1 + people.length + specific.length + (everyone ? 1 : 0);
  return {
    owner: { id: i.ownerId ?? null, name: i.ownerName },
    general: { level: everyone ? everyone.level : null, row: everyone },
    people, agents: { on: i.agentsOn ?? (inherited || specific.length > 0), inherited, specific }, link,
    inheritedFrom: i.folderName ? `From the folder ${i.folderName}` : "From the Space",
    count, empty: people.length === 0 && specific.length === 0 && everyone === null && !inherited,
  };
}

/** The line under the title and the count behind the sheet's button: one number, from the same view. */
export function accessCount(i: AccessViewInput): number {
  return accessView(i).count;
}

/** The one-line description of a level, for the picker's menu. */
export function levelHint(type: ShareItemType, level: ShareLevel): string {
  const by: Record<ShareItemType, Partial<Record<ShareLevel, string>>> = {
    agent: { use: "Chat with it and put it to work in their own chats, tasks, automations and crews, on their own AI account.", edit: "Change its instructions, context and tools.", manage: "Share it, move it and delete it." },
    vault: { use: "Agents and automations use it. The value stays hidden.", view: "See the value and use it.", edit: "See, use and change it.", manage: "Change it, share it and delete it." },
    automation: { view: "See it, its runs and its history.", use: "Run it.", edit: "Change it and pause it.", manage: "Share it and delete it." },
    note: { view: "Read it.", edit: "Read it and change it.", manage: "Share it, move it and delete it." },
    file: { view: "Open everything inside.", edit: "Open and change everything inside.", manage: "Share it, move it and delete it." },
    artifact: { view: "Open it and read it.", edit: "Open it and change it.", manage: "Share it, move it and delete it." },
    project: { view: "Open the project and its work.", edit: "Change the plan, tasks and files.", manage: "Share it and delete it." },
    record: { view: "Open this record.", edit: "Open it and change it.", manage: "Share it and delete it." },
    rtype: { view: "Open every record of this type.", edit: "Open and change every record of this type.", manage: "Change its fields and views, and share it." },
  };
  return by[type][level] ?? "";
}

/** The line under "Everyone in Northwind": what the chosen level means, or that nobody but the people added can open it. */
export function generalSub(type: ShareItemType, level: ShareLevel | null, spaceName: string, itemName: string): string {
  if (level === null) return "Only people added can open it";
  const verb = type === "vault" && level === "use" ? "use it without seeing it" : ({ view: "view", use: "use", edit: "edit", manage: "manage" } as Record<ShareLevel, string>)[level];
  return type === "vault" && level === "use" ? `Anyone in ${spaceName} can ${verb}` : `Anyone in ${spaceName} can ${verb} ${itemName}`;
}

/** "Already has access through Everyone in Northwind": a person at or below the general level gains nothing from their own grant. */
export function redundantVia(type: ShareItemType, general: ShareLevel | null, level: ShareLevel, spaceName: string): string | null {
  if (general === null) return null;
  return levelRank(type, level) <= levelRank(type, general) ? `Already has access through Everyone in ${spaceName}` : null;
}

/** Joins names the way a sentence does, with the possessive of each: "Omar", "Omar and Sara". Pronouns are never guessed. */
export function possessiveOf(names: readonly string[]): string {
  return names.length === 1 ? `${names[0]}'s` : "their";
}

/* ---------- the Add menu: a plain people picker for places that only need to pick someone (a routine's new owner) ---------- */

export interface DirectoryEntry { id: string; name: string; sub?: string }
export interface ShareDirectory { people?: readonly DirectoryEntry[]; groups?: readonly DirectoryEntry[]; roles?: readonly DirectoryEntry[]; agents?: readonly DirectoryEntry[] }

/** People, Teams, Roles, Agents; entries that already have access show a check and do nothing. */
export function addMenu(directory: ShareDirectory, shares: readonly { subjectKind: string; subjectId: string }[], onAdd: (subject: { kind: ShareSubjectKind; id: string }, name: string) => void): MenuEntry[] {
  const have = new Set(shares.map((r) => `${r.subjectKind}:${r.subjectId}`));
  const out: MenuEntry[] = [];
  const groups: readonly { head: string; kind: ShareSubjectKind; list: readonly DirectoryEntry[] | undefined }[] = [
    { head: "People", kind: "person", list: directory.people },
    { head: "Teams", kind: "group", list: directory.groups },
    { head: "Roles", kind: "role", list: directory.roles },
    { head: "Agents", kind: "agent", list: directory.agents },
  ];
  for (const g of groups) {
    if (g.list === undefined || g.list.length === 0) continue;
    if (out.length > 0) out.push({ separator: true });
    out.push({ head: g.head });
    for (const e of g.list) {
      const added = have.has(`${g.kind}:${e.id}`);
      out.push({ label: e.name, checked: added, ...(added ? {} : { onSelect: () => onAdd({ kind: g.kind, id: e.id }, e.name) }) });
    }
  }
  return out;
}
