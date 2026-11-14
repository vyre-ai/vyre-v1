// An agent's write never silently replaces someone else's change (13 Nov 2026, finding F50; lead's ruling 14 Nov).
// Two agents asked together in one chat now run together. A tool that changes a thing already there (a file, a record, a task) takes the version the writer last saw, and the capability refuses a write made on an older one.
// A model rarely sends that version, and nothing leads it to, so the tool layer sends it: the version this agent's own last read or write of the thing returned (kept for the turn), or, for a thing it never read in this turn,
// the version the thing had when the turn started. Whoever changed it since, the write is refused, and the model is told in one plain sentence to read again and make its change on top. A version the model sends itself is kept.
// A brand-new thing needs nothing. What the model sees is unchanged: no field is added to a tool, a description or a result.
import type { ToolCtx } from "./types.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

/** A thing an agent can change that counts its saves. */
export interface VersionedKind {
  kind: "file" | "record" | "task" | "page" | "automation";
  /** The words for it in a refusal ("file", "record", "task"). */
  noun: string;
  /** The write tools that take a version, with the input field that carries it. */
  writes: readonly string[];
  field: "baseVersion" | "expectedVersion";
  /** The key of the thing a write names, or undefined when the write names none (a new one). */
  idOf(input: Obj): string | undefined;
  /** A read that tells the version of the thing now, with when it last changed (and for a file its versions with their times). */
  peek(id: string, input: Obj): { cap: string; input: Obj };
  /** The version now, the time of the last change, and (a file) the version it had at a time. */
  now(out: unknown, at: number | undefined): { version: number; changedAt?: number; atTime?: number } | null;
}

const KINDS: readonly VersionedKind[] = [
  {
    kind: "file",
    noun: "file",
    writes: ["files.write", "files.save"],
    field: "baseVersion",
    idOf: (i) => str(i["fileId"]),
    peek: (id) => ({ cap: "files.versions", input: { fileId: id } }),
    now: (out, at) => {
      const list = obj(out)?.["versions"];
      if (!Array.isArray(list)) return null;
      let latest: number | undefined;
      let atTime: number | undefined;
      let changedAt: number | undefined;
      for (const v of list) {
        const n = int(obj(v)?.["n"]);
        if (n === undefined) continue;
        const when = typeof obj(v)?.["at"] === "number" ? (obj(v)!["at"] as number) : undefined;
        if (latest === undefined || n > latest) {
          latest = n;
          changedAt = when;
        }
        if (at !== undefined && when !== undefined && when < at && (atTime === undefined || n > atTime)) atTime = n;
      }
      return latest === undefined
        ? null
        : {
            version: latest,
            ...(changedAt === undefined ? {} : { changedAt }),
            ...(atTime === undefined ? {} : { atTime }),
          };
    },
  },
  {
    kind: "record",
    noun: "record",
    writes: ["records.update"],
    field: "baseVersion",
    idOf: (i) => (str(i["type"]) && str(i["recordId"]) ? `${String(i["type"])}/${String(i["recordId"])}` : undefined),
    peek: (_id, i) => ({ cap: "records.get", input: { type: i["type"], recordId: i["recordId"] } }),
    now: (out) => {
      const r = obj(obj(out)?.["record"]);
      const version = int(r?.["version"]);
      if (version === undefined) return null;
      return { version, ...(typeof r?.["updatedAt"] === "number" ? { changedAt: r["updatedAt"] as number } : {}) };
    },
  },
  {
    kind: "task",
    noun: "task",
    writes: ["tasks.update"],
    field: "expectedVersion",
    idOf: (i) => str(i["taskId"]),
    peek: (id) => ({ cap: "tasks.get", input: { taskId: id } }),
    now: (out) => {
      const t = obj(obj(out)?.["task"]);
      const version = int(t?.["version"]);
      if (version === undefined) return null;
      return { version, ...(typeof t?.["updatedAt"] === "number" ? { changedAt: t["updatedAt"] as number } : {}) };
    },
  },
  {
    kind: "page",
    noun: "page",
    writes: ["memory.page.put"],
    field: "baseVersion",
    idOf: (i) => str(i["pageId"]),
    peek: (id) => ({ cap: "memory.page.get", input: { pageId: id } }),
    now: (out) => {
      const p = obj(obj(out)?.["page"]);
      const version = int(p?.["version"]);
      if (version === undefined) return null;
      return { version, ...(typeof p?.["updatedAt"] === "number" ? { changedAt: p["updatedAt"] as number } : {}) };
    },
  },
  {
    kind: "automation",
    noun: "automation",
    writes: ["automations.update"],
    field: "expectedVersion",
    idOf: (i) => str(i["automationId"]),
    peek: (id) => ({ cap: "automations.get", input: { automationId: id } }),
    now: (out) => {
      const a = obj(obj(out)?.["automation"]);
      const version = int(a?.["version"]);
      if (version === undefined) return null;
      return { version, ...(typeof a?.["updatedAt"] === "number" ? { changedAt: a["updatedAt"] as number } : {}) };
    },
  },
];

const BY_WRITE = new Map<string, VersionedKind>(KINDS.flatMap((k) => k.writes.map((w) => [w, k] as const)));

/** The kind a write tool changes, or undefined for a tool that takes no version. */
export function kindOfWrite(cap: string): VersionedKind | undefined {
  return BY_WRITE.get(cap);
}

/**
 * What a call told about the version of things: the capability's input and its output, whatever the capability. A read of a file (not of an older version of it), a record, a task, or any write that returns the thing
 * (create, update, transition, move, save) says the version the thing is at now. Anything else says nothing.
 */
export function learned(cap: string, input: unknown, out: unknown): Array<{ key: string; version: number }> {
  const o = obj(out);
  const i = obj(input) ?? {};
  const found: Array<{ key: string; version: number }> = [];
  if (!o) return found;
  if (cap === "files.read" && i["versionId"] === undefined) {
    const id = str(i["fileId"]);
    const version = int(o["version"]);
    if (id && version !== undefined) found.push({ key: `file:${id}`, version });
  }
  const file = obj(o["file"]);
  if (file && cap.startsWith("files.")) {
    const id = str(file["fileId"]);
    const version = int(file["version"]);
    if (id && version !== undefined) found.push({ key: `file:${id}`, version });
  }
  const record = obj(o["record"]);
  if (record && cap.startsWith("records.")) {
    const id = str(record["id"]);
    const type = str(record["type"]);
    const version = int(record["version"]);
    if (id && type && version !== undefined) found.push({ key: `record:${type}/${id}`, version });
  }
  const task = obj(o["task"]);
  if (task && cap.startsWith("tasks.")) {
    const id = str(task["id"]);
    const version = int(task["version"]);
    if (id && version !== undefined) found.push({ key: `task:${id}`, version });
  }
  const page = obj(o["page"]);
  if (page && cap.startsWith("memory.page.")) {
    const id = str(page["pageId"]);
    const version = int(page["version"]);
    if (id && version !== undefined) found.push({ key: `page:${id}`, version });
  }
  const automation = obj(o["automation"]);
  if (automation && cap.startsWith("automations.")) {
    const id = str(automation["id"]);
    const version = int(automation["version"]);
    if (id && version !== undefined) found.push({ key: `automation:${id}`, version });
  }
  return found;
}

/** How long what an agent saw is kept when there is no turn to end it (a CLI engine's session spans many turns): after this, the thing counts as one the agent has not read. */
const KEEP_MS = 10 * 60_000;
const MAX_TURNS = 400;
const MAX_THINGS = 300;

interface Seen {
  version: number;
  at: number;
}
interface Memory {
  /** The turn this memory is of (its id, else when it began); a new turn starts a new memory. */
  turnId: string | number | undefined;
  things: Map<string, Seen>;
}

/** What each agent has seen of each thing in its current turn, by thread and agent. A thing is remembered as the version of its last read or write by this agent. */
export class SeenVersions {
  private readonly memories = new Map<string, Memory>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private memory(ctx: ToolCtx): Memory {
    const k = `${ctx.thread.threadId}|${ctx.agentId}`;
    let m = this.memories.get(k);
    const turn = ctx.turnId ?? ctx.turnStartedAt;
    if (!m || (turn !== undefined && m.turnId !== turn)) {
      m = { turnId: turn, things: new Map() };
      this.memories.delete(k);
      this.memories.set(k, m);
      if (this.memories.size > MAX_TURNS) this.memories.delete(this.memories.keys().next().value as string);
    }
    return m;
  }

  get(ctx: ToolCtx, key: string): number | undefined {
    const s = this.memory(ctx).things.get(key);
    if (!s) return undefined;
    if (ctx.turnId === undefined && ctx.turnStartedAt === undefined && this.now() - s.at > KEEP_MS) return undefined;
    return s.version;
  }

  set(ctx: ToolCtx, key: string, version: number): void {
    const things = this.memory(ctx).things;
    things.delete(key);
    things.set(key, { version, at: this.now() });
    if (things.size > MAX_THINGS) things.delete(things.keys().next().value as string);
  }
}

/** The words a refusal made by the tool layer itself says: the thing changed after the turn began, and the agent had not read it since. */
export const changedSinceTurn = (noun: string): string =>
  `This ${noun} changed after you started working, and you have not read it since, so your change was not saved. Read it again and make your change on top of what is there now.`;
