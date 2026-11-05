// Frozen props for ui/AccessSheet: the one "Add people and agents" and "Share" sheet.
// Add mode puts people, agents, outside agents and guests into a chat, channel, thread or project.
// Share mode gives people, groups, roles and the Space a level on one item (a note, folder, record, record type, artifact, project, Vault item or agent).
// The sheet holds no data and makes no call: the host passes the directory and the item, and takes the picks back through onAdd, onShare, onUnshare and onPoke.
// The pure contract builders (the capability inputs) live in model.ts, so the hosts and the sheet cannot drift.

import type { CapMap } from "../../../generated/types.ts";

/** The kinds of resource access.share takes. */
export type ShareResourceType = CapMap["access.share"]["in"]["resource"]["type"];

/** Phone layouts pass `compact`. Desktop passes `regular`. */
export type Density = "regular" | "compact";

/* ---------- people and agents ---------- */

export type EntryKind = "person" | "agent" | "outside" | "group" | "role" | "space";

/** One row the sheet can offer or show: a Space member, an agent, one of the owner's outside agents, a group, a role or the Space itself. */
export interface AccessEntry {
  id: string;
  name: string;
  /** The line under the name. */
  sub?: string;
  kind: EntryKind;
  /** The owner's own private Assistant: drawn with the V mark and named "Assistant". */
  assistant?: boolean;
  /** Share mode: the subject the host wants in access.share when it is not the entry's own kind (the Space row is a group in the grants table). */
  subject?: { kind: "person" | "agent" | "group" | "role"; id: string };
}

export interface AccessDirectory {
  /** The few the person works with most, shown first when nothing is typed. */
  suggested?: readonly AccessEntry[];
  people?: readonly AccessEntry[];
  /** The owner's Assistant first, then the Space's agents and project teammates. */
  agents?: readonly AccessEntry[];
  /** The owner's own outside agents (Claude Code, Codex). Empty means none is connected yet. */
  outside?: readonly AccessEntry[];
  /** Share mode: groups and roles. */
  groups?: readonly AccessEntry[];
  /** Share mode: the "Anyone in the Space" row. */
  space?: AccessEntry;
}

/* ---------- how an agent answers in a chat ---------- */

/** lead: answers everything. tag: answers when mentioned. listen: reads, and posts only when poked. */
export type AgentHow = "lead" | "tag" | "listen";
export type AgentWhen = "always" | "topics" | "hours";
export type AgentStyle = "short" | "full";

export interface AgentSettings {
  how: AgentHow;
  when: AgentWhen;
  topics: string;
  hoursFrom: string;
  hoursTo: string;
  style: AgentStyle;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { how: "tag", when: "always", topics: "", hoursFrom: "09:00", hoursTo: "17:00", style: "short" };

/* ---------- picks ---------- */

export type PickKind = EntryKind | "guest" | "new";

/** Add-mode roles for a person: member or can view; for a guest: gview or greply. Share mode: the ShareLevel id. */
export interface AccessPick {
  /** `<kind>:<id>`; a guest is `guest:<email>`; a new chat agent is `new:<n>`. */
  key: string;
  kind: PickKind;
  id: string;
  name: string;
  sub?: string;
  assistant?: boolean;
  role: string;
  /** Agents and outside agents, add mode. */
  settings?: AgentSettings;
  email?: string;
  /** A new chat agent: its one-line brief and model. */
  brief?: string;
  model?: string;
  /** Share mode: the subject to grant (see AccessEntry.subject). */
  subject?: { kind: "person" | "agent" | "group" | "role"; id: string };
}

/* ---------- add mode ---------- */

export type AddTargetKind = "chat" | "channel" | "thread" | "project";

export interface AddTarget {
  kind: AddTargetKind;
  /** Display name: "#launch", "Lab 8", "The upload contract". */
  name: string;
  /** The name of the files folder they get. Left out when the target has none: the sentence then says nothing about files. */
  filesFolder?: string | undefined;
  /** The name of the records scope they get (a project's records). Left out when there is none: the sentence then says nothing about records. */
  recordsFolder?: string | undefined;
  /** A project's chat: the project's name, whose files they get, and how many records are linked to it. Replaces the folder and records names above: a project reads "Rivera's files, and its 3 linked records". */
  project?: { name: string; hasFiles: boolean; linkedRecords: number } | undefined;
}

export interface LinkInfo {
  /** The exact line to run once in the agent's terminal: `claude mcp add --transport http vyre <url>`. */
  command: string;
  /** Set when an outside agent has connected: its name. Left out, the sheet says it is waiting. */
  connected?: string;
  onCopy?(): void;
}

/* ---------- share mode ---------- */

export type ShareLevel = "view" | "use" | "edit" | "manage";
export type ShareSubjectKind = "person" | "group" | "role" | "agent" | "link";
export type ShareVia = "owner" | "grant" | "folder" | "space";

export type ShareItemType = "note" | "file" | "record" | "rtype" | "artifact" | "project" | "vault" | "agent" | "automation" | "skill";

/** One row of "Who has access". */
export interface ShareRow {
  subjectKind: ShareSubjectKind;
  subjectId: string;
  name: string;
  level: ShareLevel;
  via: ShareVia;
  /** Set when the row is inherited. The sheet shows it and the item cannot lower it. */
  fromFolderId: string | null;
  /** Records only: the grant also carries the export right. */
  canExport?: boolean;
  /** Records only: the holder may share it further, up to their own level. */
  canShare?: boolean;
  /** Somebody else's Assistant or private agent. The sheet never lists one by name. */
  privateAgent?: boolean;
}

export type Audience = "space" | "added" | "me";
export type Exporters = "admins" | "viewers" | "chosen";
export type RowFlag = "export" | "reshare";

/** Records: who can see it, the two switches under each person, and who may export. Left out, the sheet is the plain share sheet. */
export interface RecordsMode {
  audience: Audience;
  onAudience(next: Audience): void;
  /** A record's type: the record follows it until it is set apart, and the first choice reads "Follows Deals". Left out for a type. */
  follows?: string;
  /** The type's export setting; left out for a single record. */
  exporters?: Exporters;
  onExporters?(next: Exporters): void;
  /** A type: links to people outside the Space are allowed (off unless turned on). */
  outside?: boolean;
  onOutside?(on: boolean): void;
  onFlag(row: ShareRow, flag: RowFlag, on: boolean): void;
  /** May the viewer change the audience and the switches. False draws them as they are. */
  canChange: boolean;
  subtitle: string;
}

export interface ShareInput {
  resource: { type: ShareResourceType; id: string };
  subject: { kind: ShareSubjectKind; id: string };
  level: ShareLevel;
  /** Set when the host gives the sheet newKey; access.share requires one. */
  idempotencyKey?: string;
}

/** Whether the people hear of it (a notification and an Inbox line: "Irfad shared Dex with you"), and an optional message to go with it. */
export interface ShareOpts {
  notify: boolean;
  message?: string;
}

export interface UnshareInput {
  resource: { type: ShareResourceType; id: string };
  subject: { kind: ShareSubjectKind; id: string };
}

/* ---------- the sheet ---------- */

interface CommonProps {
  density: Density;
  directory: AccessDirectory;
  /** The signed-in person: an outside agent of theirs shows to others as "<ownerName> (Agent)". */
  ownerName: string;
  onClose(): void;
  /** Poke starts one turn now. Shown on every agent row. */
  onPoke?(agentId: string): void;
  /** Add mode: who is already in. Agents here get Poke and a settings gear. */
  here?: readonly AccessEntry[];
  /** Add mode: how each agent already in the chat answers, by agent id. A missing one reads as the default. */
  agentSettings?: Readonly<Record<string, AgentSettings>>;
  /** The gear on a Here now row saved new settings for that agent. */
  onAgentSettings?(agentId: string, settings: AgentSettings): void;
  /** Add mode: take an outside agent out of the chat. Shown as an x on its Here now row; the host calls threads.outside_agent.remove. */
  onRemoveHere?(entry: AccessEntry): void;
  /** The models the New agent view offers. */
  models?: readonly string[];
  link?: LinkInfo;
  /** The most the person can give: levels above it are greyed with "(you do not have this)". Left out: everything. */
  maxLevel?: ShareLevel;
  /** Finer than maxLevel: asked for each level. */
  canGive?(level: ShareLevel): boolean;
  testID?: string;
}

export interface AddSheetProps extends CommonProps {
  mode: "add";
  target: AddTarget;
  /** False where no capability can give a new member the earlier messages: the "Include earlier messages" switch stays hidden. Default true. */
  earlierMessages?: boolean;
  /** The picks and whether earlier messages go with them. */
  onAdd(picks: readonly AccessPick[], opts: { earlier: boolean }): void;
}

export interface ShareSheetProps extends CommonProps {
  mode: "share";
  /** access.share and access.unshare address the item by these. */
  resourceType: ShareResourceType;
  resourceId: string;
  itemType: ShareItemType;
  /** "assistant": the owner's private Assistant, which cannot be shared. */
  itemKind?: "assistant";
  itemName: string;
  /** What the item is called in a sentence (default by type; a file shared on its own passes "file"). */
  itemLabel?: string;
  /** Levels this item offers, narrowed from its type's own list. Left out: all of the type's. */
  levels?: readonly ShareLevel[];
  /** Folder sharing covers the children; an item share sits on top of its folder. */
  target?: "folder" | "item";
  subtitle?: string;
  ownerId?: string;
  shares: readonly ShareRow[];
  allowExternal?: boolean;
  folderName?: string;
  /** Who ends up seeing it: name, how, level. Shown as a quiet box when given. */
  sees?: readonly { name: string; via: string; level: string }[];
  records?: RecordsMode;
  /** `opts` says whether to tell the people, and the line to send with it: Share sends one call per person, each with the same opts. */
  onShare?(input: ShareInput, opts?: ShareOpts): void;
  onUnshare?(input: UnshareInput): void;
  onCopyLink?(): void;
  /** One fresh idempotency key per call, so every ShareInput the sheet hands back can go straight to access.share. */
  newKey?(): string;
  /** A guest picked by email. */
  onInviteGuest?(input: { email: string; level: ShareLevel }): void;
  /** The New agent button on the Assistant notice. */
  onNewAgent?(): void;
  /** The Space's name, for "Everyone in Northwind". */
  spaceName?: string;
  /** The signed-in person: removing themselves asks first, and only the owner sees Make owner. */
  meId?: string;
  /** The host can tell the people it shares with (Notify people): without it the switch is not shown. */
  notifyPeople?: boolean;
  /** Make this person the owner (the owner's own view only). Left out: no such item in the menu. */
  onMakeOwner?(subject: { kind: ShareSubjectKind; id: string }): void;
  /** Agents in the Space may call this item: left out, the line is shown as it is and cannot be flipped. */
  onAgents?(on: boolean): void;
  /** Whether agents in the Space may call this item, when the server says (access.shares_of agentsCanCall). Left out: read from the rows. */
  agentsOn?: boolean;
}

export type AccessSheetProps = AddSheetProps | ShareSheetProps;

export const frozenAddSheetProps = {
  mode: "add",
  density: "regular",
  ownerName: "Irfad",
  target: { kind: "chat", name: "Upload contract", filesFolder: "Portal uploads", recordsFolder: "Clients" },
  directory: {
    suggested: [{ id: "usr_sara", name: "Sara Malik", sub: "Space member", kind: "person" }],
    people: [
      { id: "usr_sara", name: "Sara Malik", sub: "Space member", kind: "person" },
      { id: "usr_omar", name: "Omar Reyes", sub: "Space member", kind: "person" },
    ],
    agents: [
      { id: "agt_assistant", name: "Assistant", sub: "Yours, private to you", kind: "agent", assistant: true },
      { id: "agt_docs", name: "Docs", sub: "Space agent", kind: "agent" },
    ],
    outside: [{ id: "out_cc", name: "Claude Code", sub: "On this Mac", kind: "outside" }],
  },
  here: [{ id: "agt_mira", name: "Mira", sub: "Project teammate", kind: "agent" }],
  models: ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "GPT-5 Codex"],
  link: { command: "claude mcp add --transport http vyre https://northwind.vyre.run/mcp" },
  onClose: () => undefined,
  onPoke: () => undefined,
  onAdd: () => undefined,
} as const satisfies AddSheetProps;

export const frozenShareSheetProps = {
  mode: "share",
  density: "regular",
  ownerName: "Irfad",
  resourceType: "folder",
  resourceId: "fld_clients",
  itemType: "file",
  itemName: "Q4 invoices",
  shares: [{ subjectKind: "person", subjectId: "usr_omar", name: "Omar Reyes", level: "edit", via: "grant", fromFolderId: null }],
  directory: {
    people: [{ id: "usr_sara", name: "Sara Malik", sub: "Space member", kind: "person" }],
    space: { id: "space", name: "Anyone in the Space", sub: "Everyone who is in Northwind", kind: "space", subject: { kind: "group", id: "space" } },
  },
  onClose: () => undefined,
} as const satisfies ShareSheetProps;
