// The Share adapters: one typed adapter per kind of item, so one Share sheet serves every place (owner-approved Add and Share sheet, lane l-share2).
// The sheet asks an adapter for four things: the levels it may offer, who has access now, a change of level, a removal. It never names a capability.
// A person cannot give more than they have: `levels` is already cut to the caller's own level, and `set` refuses a higher one before any call is made.
import { ladderFor } from "../../../../packages/contracts/src/levels.ts";
import type { Level, ResourceType } from "../../../../packages/contracts/src/types.ts";

/** The runtime call every adapter makes through. Rejects with the host error shape. */
export type ShareCall = (cap: string, input: Record<string, unknown>) => Promise<unknown>;

export type ShareKind = "note" | "vault_item" | "vault_folder" | "file" | "folder" | "artifact" | "record" | "record_type" | "project" | "agent";

export interface Subject { kind: "person" | "group" | "role" | "agent"; id: string }

/** One level a type offers: its words in the sheet and what the person gets. */
export interface LevelOption { id: Level; label: string; gets: string }

export interface AccessEntry {
  subject: Subject;
  name: string;
  level: Level;
  /** owner: the item's owner; grant: given on this item; folder: from the folder it sits in (the item cannot lower it). */
  via: "owner" | "grant" | "folder";
  fromFolderId: string | null;
  /** Records only: the switches the grant carries. */
  flags?: { export?: boolean; reshare?: boolean };
}

export interface AccessState {
  owner: { id: string; name: string } | null;
  entries: AccessEntry[];
  /** "Anyone in the Space": the level everyone holds on this item, or null when it is not open to the Space. */
  anyone: Level | null;
  /** The caller's own level; null when unknown. */
  mine: Level | null;
  /** May the caller change who has access? */
  canShare: boolean;
}

export interface ShareAdapter {
  kind: ShareKind;
  resource: { type: string; id: string };
  /** What the sheet offers, cut to what the caller may give. */
  levels: readonly LevelOption[];
  /** Whether the type has an "Anyone in the Space" row. */
  hasAnyone: boolean;
  list(): Promise<AccessState>;
  /** Give a level, or change one. Rejects with `not_contained` when it is above the caller's own. */
  set(subject: Subject, level: Level): Promise<void>;
  remove(subject: Subject): Promise<void>;
  /** "Anyone in the Space": a level, or null to close it. */
  setAnyone(level: Level | null): Promise<void>;
}

export class NotContained extends Error {
  readonly code = "permission.not_contained";
  constructor(have: Level | null, want: Level) { super(`you hold ${have ?? "nothing"} here and cannot give ${want}`); }
}

/* ---------- what each type offers, in its own words ---------- */

const OPT = (id: Level, label: string, gets: string): LevelOption => ({ id, label, gets });

export const LEVELS: Readonly<Record<ShareKind, readonly LevelOption[]>> = {
  vault_item: [
    OPT("use", "Can use without seeing", "Their agents and automations can use it. They never see the value."),
    OPT("view", "Can view", "They can see the value and use it."),
    OPT("edit", "Can edit", "They can see it, use it and change it."),
  ],
  vault_folder: [
    OPT("use", "Can use without seeing", "Everything in the folder can be used, none of it seen."),
    OPT("view", "Can view", "They can see and use everything in the folder."),
    OPT("edit", "Can edit", "They can see, use and change everything in the folder."),
  ],
  record_type: [
    OPT("view", "Can view records", "They can open every record of this type."),
    OPT("edit", "Can edit records", "They can open and change every record of this type."),
    OPT("manage", "Can manage the type", "They can also change its fields and views, and share it."),
  ],
  record: [
    OPT("view", "Can view", "They can open this record."),
    OPT("edit", "Can edit", "They can open and change this record."),
    OPT("manage", "Can manage", "They can also share it and delete it."),
  ],
  agent: [
    OPT("view", "Can chat with", "They can talk to the agent. It works with what they can see."),
    OPT("use", "Can use", "They can give it tasks, put it in their automations and projects."),
    OPT("edit", "Can edit", "They can change how it works."),
    OPT("manage", "Can manage", "They can also share it, pause it and delete it."),
  ],
  note: [
    OPT("view", "Can view", "They can read the note."),
    OPT("edit", "Can edit", "They can read and change the note."),
  ],
  file: [OPT("view", "Can view", "They can open it."), OPT("edit", "Can edit", "They can open and change it."), OPT("manage", "Can manage", "They can also share it, move it and delete it.")],
  folder: [OPT("view", "Can view", "They can open everything inside."), OPT("edit", "Can edit", "They can open and change everything inside."), OPT("manage", "Can manage", "They can also share it, move it and delete it.")],
  artifact: [OPT("view", "Can view", "They can open it."), OPT("edit", "Can edit", "They can open and change it."), OPT("manage", "Can manage", "They can also share it, move it and delete it.")],
  project: [OPT("view", "Can view", "They can open the project and its work."), OPT("edit", "Can edit", "They can change the plan, tasks and files."), OPT("manage", "Can manage", "They can also share it and delete it.")],
};

/** The access resource type a kind lives under. */
export const RESOURCE_OF: Readonly<Record<ShareKind, ResourceType>> = {
  note: "file", vault_item: "vault_item", vault_folder: "vault_folder", file: "file", folder: "folder", artifact: "site",
  record: "record", record_type: "record_type", project: "project", agent: "agent",
};

const rankOf = (type: string, l: Level): number => ladderFor(type as ResourceType).indexOf(l);

/** The levels a type offers that the caller may give: nothing above their own. A caller with an unknown level is offered none. */
export function offered(kind: ShareKind, mine: Level | null): LevelOption[] {
  if (mine === null) return [];
  const type = RESOURCE_OF[kind];
  return LEVELS[kind].filter((o) => rankOf(type, o.id) <= rankOf(type, mine));
}

/* ---------- access.* adapters (everything but Notes) ---------- */

interface SharesOut {
  shares: Array<{ grant: { subject: { kind: string; id: string }; level: Level; conditions: { export?: boolean; reshare?: boolean }; resource: { id: string } }; through: string }>;
  mine?: Level;
  can?: { share: boolean; manage: boolean };
}

const EVERYONE: Subject = { kind: "group", id: "grp_everyone" };
const SUBJECTS = new Set(["person", "group", "role", "agent"]);

export interface AdapterDeps {
  call: ShareCall;
  /** A person's, group's or agent's display name. */
  nameOf(id: string): string;
}

export function accessAdapter(deps: AdapterDeps, kind: Exclude<ShareKind, "note">, resource: { type?: string; id: string }): ShareAdapter {
  const ref = { type: resource.type ?? RESOURCE_OF[kind], id: resource.id };
  let mine: Level | null = null;
  const owns = (want: Level): void => { if (mine === null || rankOf(ref.type, want) > rankOf(ref.type, mine)) throw new NotContained(mine, want); };
  const known = (want: Level): void => { if (!LEVELS[kind].some((o) => o.id === want)) throw new Error(`${kind} does not offer ${want}`); };
  const adapter: ShareAdapter = {
    kind, resource: ref,
    levels: [],
    hasAnyone: kind !== "record",
    async list() {
      const out = (await deps.call("access.shares_of", { resource: ref })) as SharesOut;
      mine = out.mine ?? null;
      (adapter as { levels: readonly LevelOption[] }).levels = offered(kind, mine);
      const entries: AccessEntry[] = [];
      let owner: AccessState["owner"] = null;
      let anyone: Level | null = null;
      for (const s of out.shares) {
        const g = s.grant;
        if (s.through === "owner") { owner = { id: g.subject.id, name: deps.nameOf(g.subject.id) }; continue; }
        if (g.subject.kind === EVERYONE.kind && g.subject.id === EVERYONE.id && s.through !== "folder") { anyone = g.level; continue; }
        if (!SUBJECTS.has(g.subject.kind)) continue;
        const flags = { ...(g.conditions.export === true ? { export: true } : {}), ...(g.conditions.reshare === true ? { reshare: true } : {}) };
        entries.push({
          subject: { kind: g.subject.kind as Subject["kind"], id: g.subject.id }, name: deps.nameOf(g.subject.id), level: g.level,
          via: s.through === "folder" ? "folder" : "grant", fromFolderId: s.through === "folder" ? g.resource.id : null,
          ...(Object.keys(flags).length > 0 ? { flags } : {}),
        });
      }
      const canShare = out.can ? out.can.share : mine !== null && rankOf(ref.type, mine) >= rankOf(ref.type, "edit");
      return { owner, entries, anyone, mine, canShare };
    },
    async set(subject, level) {
      known(level); owns(level);
      await deps.call(kind === "vault_item" || kind === "vault_folder" ? "vault.share" : "access.share", { resource: ref, subject, level });
    },
    async remove(subject) {
      await deps.call(kind === "vault_item" || kind === "vault_folder" ? "vault.unshare" : "access.unshare", { resource: ref, subject });
    },
    async setAnyone(level) {
      if (level === null) { await adapter.remove(EVERYONE); return; }
      await adapter.set(EVERYONE, level);
    },
  };
  return adapter;
}

/* ---------- Notes: notes.share, only the owner shares, View or Edit ---------- */

interface NoteShare { people: Array<{ personId: string; role: "edit" | "view" }>; space: "off" | "view" | "edit" }
interface NoteLike { noteId: string; owner: string; share: NoteShare }

export function noteAdapter(deps: AdapterDeps, noteId: string, me: string): ShareAdapter {
  const ref = { type: "note", id: noteId };
  let state: NoteLike | null = null;
  const readNote = async (): Promise<NoteLike> => {
    const out = (await deps.call("notes.get", { noteId })) as { note: NoteLike };
    state = out.note;
    return state;
  };
  const adapter: ShareAdapter = {
    kind: "note", resource: ref, levels: [], hasAnyone: true,
    async list() {
      const n = await readNote();
      const isOwner = n.owner === me;
      (adapter as { levels: readonly LevelOption[] }).levels = isOwner ? LEVELS.note : [];
      return {
        owner: { id: n.owner, name: deps.nameOf(n.owner) },
        entries: n.share.people.map((p) => ({ subject: { kind: "person" as const, id: p.personId }, name: deps.nameOf(p.personId), level: p.role as Level, via: "grant" as const, fromFolderId: null })),
        anyone: n.share.space === "off" ? null : n.share.space,
        mine: isOwner ? "manage" : n.share.space === "edit" || n.share.people.find((p) => p.personId === me)?.role === "edit" ? "edit" : "view",
        canShare: isOwner,
      };
    },
    async set(subject, level) {
      if (level !== "view" && level !== "edit") throw new Error(`note does not offer ${level}`);
      if (subject.kind !== "person") throw new Error("a note is shared with people or the Space");
      if (state && state.owner !== me) throw new NotContained(null, level);
      await deps.call("notes.share", { noteId, people: [{ personId: subject.id, role: level }] });
    },
    async remove(subject) {
      if (state && state.owner !== me) throw new NotContained(null, "view");
      await deps.call("notes.share", { noteId, people: [{ personId: subject.id, role: "remove" }] });
    },
    async setAnyone(level) {
      if (level !== null && level !== "view" && level !== "edit") throw new Error(`note does not offer ${level}`);
      if (state && state.owner !== me) throw new NotContained(null, level ?? "view");
      await deps.call("notes.share", { noteId, space: level ?? "off" });
    },
  };
  return adapter;
}
