// A tab opened on an item (an automation, a record, a file, a chat, a task) is named for the item, not for its place: "Weekly digest", "Elena Rivera". The place's own name stays until the
// item's name arrives; a subject this does not know keeps the place's name. Opening the same item again finds its tab by key (tabKey = place + hash), so tabs are one per item.
import { chatName, hasRealTitle } from "../../../../../lib/chat-name.ts";

export interface Ask {
  cap: string; input: Record<string, unknown>; name(out: unknown): string | null;
  /** A name that needs more reads than the item's own (who is in a chat): asked after `name`, and replaces it when it answers. */
  resolve?(out: unknown, call: (cap: string, input: unknown) => Promise<unknown>, meId: string): Promise<string | null>;
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const at = (out: unknown, key: string, field: string): string | null => text(obj(obj(out)?.[key])?.[field]);

/** The first thing in a record's fields that reads as its name. */
export function recordTitle(fields: unknown): string | null {
  const f = obj(fields);
  if (!f) return null;
  for (const k of ["name", "title", "subject", "label"]) { const t = text(f[k]); if (t) return t; }
  for (const v of Object.values(f)) { const t = text(v); if (t) return t; }
  return null;
}

/** What to read to name a tab opened on `subject`, or null for a subject with no name to read. */
export function titleAsk(subject: { type: string; id: string }, args: Readonly<Record<string, unknown>> = {}): Ask | null {
  const { type, id } = subject;
  switch (type) {
    case "automation": return { cap: "automations.get", input: { automationId: id }, name: (o) => at(o, "automation", "name") };
    // a record is read by its type and id; the tab's hash carries the type (a record opened without one keeps the place's name)
    case "record": case "contact": return typeof args["type"] !== "string" || args["type"] === "" ? null : { cap: "records.get", input: { type: args["type"], recordId: id }, name: (o) => recordTitle(obj(obj(o)?.["record"])?.["fields"]) };
    case "project": return { cap: "projects.get", input: { projectId: id }, name: (o) => at(o, "project", "title") };
    case "file": case "doc": case "document": return { cap: "files.get", input: { fileId: id }, name: (o) => at(o, "file", "name") };
    case "task": return { cap: "tasks.get", input: { taskId: id }, name: (o) => at(o, "task", "title") };
    case "artifact": return { cap: "sites.get", input: { siteId: id }, name: (o) => at(o, "site", "name") };
    case "goal": return { cap: "goals.get", input: { goalId: id }, name: (o) => at(o, "goal", "title") };
    case "run": return { cap: "runs.get", input: { runId: id }, name: (o) => at(o, "run", "name") };
    case "chat": case "thread": return { cap: "threads.get", input: { threadId: id }, name: (o) => { const t = at(o, "thread", "title"); return hasRealTitle(t) ? t : "New chat"; }, resolve: chatTabName };
    default: return null;
  }
}

/** What to read to name a Records tab opened on a record type (its hash carries the type's key): the type's own plural, "Companies" in place of "Records". */
export function typeTitleAsk(place: string, args: Readonly<Record<string, unknown>>): Ask | null {
  const key = args["type"];
  if (place !== "records" || typeof key !== "string" || key === "") return null;
  return {
    cap: "schema.types.list", input: {},
    name: (o) => {
      const types = obj(o)?.["types"];
      const t = Array.isArray(types) ? types.map(obj).find((x) => x !== null && x["key"] === key) : undefined;
      return text(t?.["plural"]) ?? text(t?.["title"]);
    },
  };
}


/** The tab of a chat carries the chat's one name (lib/chat-name.ts), the same as the list and the header: a direct message is the person, else the title, else who is in it. */
async function chatTabName(out: unknown, call: (cap: string, input: unknown) => Promise<unknown>, meId: string): Promise<string | null> {
  const t = obj(obj(out)?.["thread"]);
  if (!t) return null;
  const agents = (Array.isArray(t["agents"]) ? t["agents"] : []).map((a) => text(obj(a)?.["agentId"])).filter((x): x is string => x !== null);
  const people = [...new Set((Array.isArray(t["members"]) ? t["members"] : []).map(obj).filter((m) => m !== null && m["kind"] === "person" && m["id"] !== meId).map((m) => String(m!["id"])))];
  const title = text(t["title"]);
  // a real title on a chat that is not a direct message needs no names
  if (hasRealTitle(title) && !(agents.length === 0 && people.length === 1)) return title;
  const names = new Map<string, string>();
  const read = async (cap: string, key: string, idKey: string): Promise<void> => {
    try { for (const r of (obj(await call(cap, {}))?.[key] as unknown[] | undefined) ?? []) { const o = obj(r); const id = text(o?.[idKey]); const n = text(o?.["name"]); if (id && n) names.set(id, n); } } catch { /* the name stays the id */ }
  };
  await Promise.all([agents.length ? read("agents.list", "agents", "agentId") : Promise.resolve(), people.length ? read("access.principals.list", "principals", "id") : Promise.resolve()]);
  return chatName({ title, kind: text(t["kind"]) ?? "chat", agents, people }, (id) => names.get(id) ?? "Someone");
}
