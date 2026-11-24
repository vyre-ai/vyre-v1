// Resources and prompts of the MCP endpoint (lane r42-mcp, 19 Nov 2026): the things in a Space as addresses a client can list, read and (in listen.ts) watch, and the Space's skills as prompts.
//   vyre://record/{type}/{recordId}   vyre://records/{type}   vyre://types
//   vyre://file/{fileId}              vyre://files/recent
//   vyre://note/{noteId}              vyre://task/{taskId}    vyre://tasks/mine
//   vyre://run/{runId}                vyre://runs/mine
//   vyre://template/{fileId}          vyre://templates        vyre://skill/{name}
// Nothing here reads anything. An address is another name for a read tool and its arguments; the server calls that tool through the same tool session as any call, so what a caller cannot read as a
// tool it cannot read as a resource, and a thing it may not see is the same "not found" as a thing that is not there. Pure functions, no clock and no I/O.

export const RESOURCE_SCHEME = "vyre://";
const MAX_URI = 512;
/** A contract id: `<prefix>_<lowercase alphanumerics>`. */
const ID = /^[a-z]{2,5}_[a-z0-9]+$/;
/** A record type key. */
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
/** A skill name (lib/skill-md.ts). */
const SKILL = /^[A-Za-z0-9._:-]{1,64}$/;
/** Rows a collection address returns. */
const PAGE = 25;
/** A collection of records reads newest first: what changed last is what a watcher wants. */
const NEWEST = [{ field: "updated_at", dir: "desc" }];
/** The most text of a skill's supporting files that goes into a prompt. */
const PROMPT_FILES_CAP = 48_000;

export type ResourceKind =
  | "record"
  | "records"
  | "types"
  | "file"
  | "files"
  | "note"
  | "task"
  | "tasks"
  | "run"
  | "runs"
  | "template"
  | "templates"
  | "skill";

export interface ResourceRoute {
  kind: ResourceKind;
  /** The read tool this address stands for. */
  tool: string;
  args: Record<string, unknown>;
}

/** The read tool an address stands for, or null when it is not an address of this server. Every part is checked against the shape it must have, so no address can carry a path or a query into a tool. */
export function routeOf(uri: unknown): ResourceRoute | null {
  if (typeof uri !== "string" || !uri.startsWith(RESOURCE_SCHEME) || uri.length > MAX_URI) return null;
  let parts: string[];
  try {
    parts = uri.slice(RESOURCE_SCHEME.length).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  const [head, a, b, ...rest] = parts;
  if (rest.length > 0) return null;
  const one = (kind: ResourceKind, tool: string, arg: string, shape: RegExp): ResourceRoute | null =>
    a !== undefined && b === undefined && shape.test(a) ? { kind, tool, args: { [arg]: a } } : null;
  const whole = (kind: ResourceKind, tool: string, args: Record<string, unknown>): ResourceRoute | null =>
    a === undefined ? { kind, tool, args } : null;
  const named = (
    kind: ResourceKind,
    word: string,
    tool: string,
    args: Record<string, unknown>,
  ): ResourceRoute | null => (a === word && b === undefined ? { kind, tool, args } : null);
  switch (head) {
    case "record":
      return a !== undefined && b !== undefined && KEY.test(a) && ID.test(b)
        ? { kind: "record", tool: "records_get", args: { type: a, recordId: b } }
        : null;
    case "records":
      return a !== undefined && b === undefined && KEY.test(a)
        ? { kind: "records", tool: "records_query", args: { type: a, limit: PAGE, sort: NEWEST } }
        : null;
    case "types":
      return whole("types", "schema_types_list", {});
    case "file":
      return a !== undefined && b === undefined && ID.test(a)
        ? { kind: "file", tool: "files_read", args: { fileId: a, as: "text" } }
        : null;
    case "files":
      return named("files", "recent", "files_recent", { limit: PAGE });
    case "note":
      return one("note", "notes_get", "noteId", ID);
    case "task":
      return one("task", "tasks_get", "taskId", ID);
    case "tasks":
      return named("tasks", "mine", "tasks_list", { scope: "mine", limit: PAGE });
    case "run":
      return one("run", "runs_get", "runId", ID);
    case "runs":
      return named("runs", "mine", "runs_list", { scope: "mine", limit: PAGE });
    case "template":
      return one("template", "documents_fields", "templateFileId", ID);
    case "templates":
      return whole("templates", "documents_templates_list", {});
    case "skill":
      return one("skill", "skills_view", "name", SKILL);
    default:
      return null;
  }
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

/** The shapes of address a client can fill in. The same for every caller. */
export const RESOURCE_TEMPLATES: readonly ResourceTemplate[] = [
  {
    uriTemplate: "vyre://record/{type}/{recordId}",
    name: "record",
    title: "Record",
    description:
      "One record. type is a record type key from vyre://types, for example vyre://record/company/rec_a1b2c3.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "vyre://records/{type}",
    name: "records",
    title: "Records of one type",
    description:
      "The newest records of one type, for example vyre://records/company. Watch it to hear of new and changed ones.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "vyre://file/{fileId}",
    name: "file",
    title: "File",
    description: "A file as text. A PDF, Word, Excel or PowerPoint file comes back as the text in it.",
    mimeType: "text/plain",
  },
  {
    uriTemplate: "vyre://note/{noteId}",
    name: "note",
    title: "Note",
    description: "One note the person you act for may read.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "vyre://task/{taskId}",
    name: "task",
    title: "Task",
    description: "One task: what it asks for, who has it and where it stands.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "vyre://run/{runId}",
    name: "run",
    title: "Run",
    description: "One run of an automation or an agent: its steps and how it ended. Watch it to hear when it finishes.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "vyre://template/{fileId}",
    name: "template",
    title: "Document template",
    description: "A document template and the fields it fills. Fill it with documents_fill.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "vyre://skill/{name}",
    name: "skill",
    title: "Skill",
    description: "A skill of this Space: its instructions and files.",
    mimeType: "text/markdown",
  },
];

export interface Resource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: { lastModified?: string; priority?: number };
}

/** The lists every caller has, before the ones read for it. */
export const FIXED_RESOURCES: readonly Resource[] = [
  {
    uri: "vyre://tasks/mine",
    name: "my-tasks",
    title: "My tasks",
    description: "Tasks assigned to the person you act for. Watch it to hear when one is assigned.",
    mimeType: "application/json",
    annotations: { priority: 0.9 },
  },
  {
    uri: "vyre://types",
    name: "record-types",
    title: "Record types",
    description: "The kinds of record this Space keeps, with the key each address uses.",
    mimeType: "application/json",
    annotations: { priority: 0.8 },
  },
  {
    uri: "vyre://files/recent",
    name: "recent-files",
    title: "Recent files",
    description: "The files the person you act for touched last.",
    mimeType: "application/json",
  },
  {
    uri: "vyre://templates",
    name: "document-templates",
    title: "Document templates",
    description: "The templates a document can be filled from.",
    mimeType: "application/json",
  },
  {
    uri: "vyre://runs/mine",
    name: "my-runs",
    title: "My runs",
    description: "Runs started by or for the person you act for. Watch it to hear when one finishes.",
    mimeType: "application/json",
  },
];

type Row = Record<string, unknown>;
const rows = (v: unknown, key: string): Row[] => {
  const list = (v as Row | null | undefined)?.[key];
  return Array.isArray(list) ? (list.filter((r) => r !== null && typeof r === "object") as Row[]) : [];
};
const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const iso = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : undefined;

/**
 * The list a caller sees: the fixed lists, then its own things by name, read for it by the three reads named here (record types, recent files, document templates). A read that failed or was refused
 * adds nothing. A row that does not have the shape of its address is left out rather than listed broken.
 */
export function listedResources(read: { types?: unknown; files?: unknown; templates?: unknown }): Resource[] {
  const out: Resource[] = [...FIXED_RESOURCES];
  for (const t of rows(read.types, "types")) {
    const key = text(t["key"]);
    if (!key || !KEY.test(key)) continue;
    const title = text(t["plural"]) ?? text(t["title"]) ?? key;
    out.push({ uri: `vyre://records/${key}`, name: `records-${key}`, title, mimeType: "application/json" });
  }
  for (const f of rows(read.files, "files")) {
    const id = text(f["fileId"]);
    const name = text(f["name"]);
    if (!id || !ID.test(id) || !name || f["deletedAt"] !== undefined) continue;
    const modified = iso(f["updatedAt"]);
    out.push({
      uri: `vyre://file/${id}`,
      name,
      ...(text(f["mime"]) ? { mimeType: text(f["mime"]) as string } : {}),
      ...(typeof f["size"] === "number" ? { size: f["size"] } : {}),
      ...(modified ? { annotations: { lastModified: modified } } : {}),
    });
  }
  for (const t of rows(read.templates, "templates")) {
    const id = text(t["fileId"]);
    const name = text(t["name"]);
    if (!id || !ID.test(id) || !name) continue;
    out.push({
      uri: `vyre://template/${id}`,
      name,
      title: name,
      description: "Document template",
      mimeType: "application/json",
    });
  }
  return out;
}

/** The three quiet reads `listedResources` is built from: tool name and arguments. */
export const LIST_READS: Readonly<
  Record<"types" | "files" | "templates", { tool: string; args: Record<string, unknown> }>
> = {
  types: { tool: "schema_types_list", args: {} },
  files: { tool: "files_recent", args: { limit: PAGE } },
  templates: { tool: "documents_templates_list", args: {} },
};

export type ResourceContent =
  | { uri: string; mimeType: string; text: string }
  | { uri: string; mimeType: string; blob: string };

/** What a read tool answered, as the contents of its address. A file is its text (or its bytes when it has none), a skill its instructions, everything else the JSON a tool call would have returned. */
export function contentsOf(route: ResourceRoute, uri: string, data: unknown): ResourceContent[] {
  const d = (data ?? {}) as Row;
  if (route.kind === "file") {
    const mime = text(d["mime"]);
    if (typeof d["text"] === "string")
      return [{ uri, mimeType: mime?.startsWith("text/") ? mime : "text/plain", text: d["text"] }];
    if (typeof d["base64"] === "string")
      return [{ uri, mimeType: mime ?? "application/octet-stream", blob: d["base64"] }];
  }
  if (route.kind === "skill") {
    const skill = (d["skill"] ?? {}) as Row;
    const body = text(skill["text"]);
    if (body) return [{ uri, mimeType: "text/markdown", text: body }];
  }
  return [{ uri, mimeType: "application/json", text: JSON.stringify(data ?? null) }];
}

/** A file with no text in it (a picture): the same address read again as bytes. */
export const asBytes = (route: ResourceRoute): ResourceRoute => ({ ...route, args: { ...route.args, as: "base64" } });
export const needsBytes = (route: ResourceRoute, data: unknown): boolean =>
  route.kind === "file" &&
  route.args["as"] === "text" &&
  typeof (data as Row | null | undefined)?.["text"] !== "string";

// ---- prompts: the Space's skills ------------------------------------------------------------------------------------------------------------------------------

export interface Prompt {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

/** The one argument every skill prompt takes: what the person wants done with it. */
const REQUEST_ARG = { name: "request", description: "What you want done", required: false };

/** The skills a chat with this agent can load, as prompts: on, not broken, and the one that wins when two share a name. In name order. */
export function promptsOf(listed: unknown): Prompt[] {
  const seen = new Set<string>();
  const out: Prompt[] = [];
  for (const s of rows(listed, "skills")) {
    const name = text(s["name"]);
    if (!name || !SKILL.test(name) || seen.has(name)) continue;
    if (s["enabled"] === false || s["broken"] !== undefined || s["shadowedBy"] !== undefined) continue;
    seen.add(name);
    out.push({
      name,
      title: text(s["label"]) ?? name,
      description: text(s["description"]) ?? "",
      arguments: [REQUEST_ARG],
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export const isSkillName = (v: unknown): v is string => typeof v === "string" && SKILL.test(v);

/** One loaded skill as the message a prompt puts in the conversation: its instructions, its files (cut when long, saying so), then what the person asked for. */
export function promptOf(
  loaded: unknown,
  request: unknown,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } | null {
  const skill = (loaded as Row | null | undefined)?.["skill"] as Row | undefined;
  const name = text(skill?.["name"]);
  const body = text(skill?.["body"]) ?? text(skill?.["text"]);
  if (!skill || !name || !body) return null;
  const parts = [`Follow the skill "${name}" from this Vyre Space.`, body];
  let room = PROMPT_FILES_CAP;
  let left = 0;
  for (const f of rows(skill, "files")) {
    const path = text(f["path"]);
    const t = text(f["text"]);
    if (!path || !t) continue;
    if (t.length > room) {
      left += 1;
      continue;
    }
    room -= t.length;
    parts.push(`File ${path}:\n${t}`);
  }
  if (left > 0) parts.push(`${left} more ${left === 1 ? "file is" : "files are"} at vyre://skill/${name}.`);
  const asked = text(request);
  if (asked) parts.push(`Request: ${asked}`);
  return {
    description: text(skill["description"]) ?? name,
    messages: [{ role: "user", content: { type: "text", text: parts.join("\n\n") } }],
  };
}

/** Values for an argument a person is typing: only a record type key can be finished from what the caller may list. */
export function completionsOf(
  ref: unknown,
  argument: unknown,
  types: unknown,
): { values: string[]; total: number; hasMore: boolean } {
  const r = (ref ?? {}) as Row;
  const a = (argument ?? {}) as Row;
  const none = { values: [], total: 0, hasMore: false };
  if (r["type"] !== "ref/resource" || typeof r["uri"] !== "string" || a["name"] !== "type") return none;
  if (!r["uri"].includes("{type}")) return none;
  const typed = typeof a["value"] === "string" ? a["value"].toLowerCase() : "";
  const all = rows(types, "types")
    .map((t) => text(t["key"]))
    .filter((k): k is string => k !== undefined && KEY.test(k) && k.startsWith(typed))
    .sort();
  return { values: all.slice(0, 100), total: all.length, hasMore: all.length > 100 };
}
