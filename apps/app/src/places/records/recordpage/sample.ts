// The sample Spaces behind the record page tests and screenshots: the table's Northwind and Harbor Studio with the clients linked to projects, a long note that names records with [[ ]], and every
// capability the page reads or writes answered from memory: the record, its type, the layout, my page choices, completeness, the relationship map, history, versions and memory facts.
// records.update changes the row (the version moves, the live reads answer again), keeps a history entry and a version, and refuses what a person may not do when `fail` is set.
import { createFakeReplica, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery, Row } from "../../../../../../client/src/index.ts";
import { createElement } from "react";
import { Text } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { LiveCap, RecordPageData } from "./data.tsx";
import type { Entry, FieldDef, Layout, RelNode, TypeDef, Version } from "./model.ts";
import type { RecordRow } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const DAY = 86_400_000;

const f = (key: string, type: string, title: string, options?: Record<string, unknown>, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type, title, ...(options ? { options } : {}), ...extra });
const choices = (...c: [string, string, string?][]): Record<string, unknown> => ({ choices: c.map(([key, title, color]) => ({ key, title, ...(color ? { color } : {}) })) });
const stages = (...c: [string, string][]): Record<string, unknown> => ({ stages: c.map(([key, title]) => ({ key, title })) });
const def = (key: string, title: string, plural: string, icon: string, titleField: string, fields: FieldDef[], o: Partial<TypeDef> = {}): TypeDef => ({ key, title, plural, icon, label: "internal", system: false, titleField, fields, version: 1, ...o });

export const CLIENT: TypeDef = def("clients", "Client", "Clients", "people", "name", [
  f("name", "text", "Name", undefined, { required: true }), f("status", "choice", "Status", choices(["lead", "Lead", "210"], ["active", "Active", "150"], ["paused", "Paused", "40"], ["closed", "Closed", "0"])),
  f("owner", "person", "Owner"), f("value", "money", "Value"), f("due", "date", "Next step due"), f("company", "text", "Company"), f("email", "email", "Email"), f("phone", "phone", "Phone"),
  f("rating", "rating", "Fit"), f("active", "checkbox", "Retainer signed"), f("projects", "relation", "Projects", { to: "projects" }), f("notes", "longtext", "Notes"), f("id_doc", "files", "ID document"), f("tax", "sealed", "Tax ID"),
], { summaryField: "company", statusField: "status", ownerField: "owner" });
export const PROJECT: TypeDef = def("projects", "Project", "Projects", "project", "name", [
  f("name", "text", "Name", undefined, { required: true }), f("status", "status", "Status", stages(["planning", "Planning"], ["active", "Active"], ["done", "Done"])), f("lead", "person", "Lead"), f("due", "date", "Due"), f("budget", "money", "Budget"),
  f("client", "relation", "Client", { to: "clients" }),
], { summaryField: "budget", statusField: "status" });

const LAYOUT: Record<string, Layout> = {
  clients: { sections: [{ key: "contact", title: "Contact", fields: ["company", "email", "phone"] }, { key: "deal", title: "Deal", fields: ["status", "owner", "value", "due", "rating", "active"] }, { key: "links", title: "Linked", fields: ["projects"] }, { key: "notes", title: "Notes", fields: ["notes"], folded: false }, { key: "private", title: "Private", fields: ["id_doc", "tax"], folded: true }] },
  projects: { sections: [] },
};

const NAMES = ["Elena Rivera", "Marcus Pruitt", "Priya Nair"] as const;
const PROJECTS = ["Rivera engagement", "Rivera matter", "Pruitt estate plan"] as const;

export interface PageSpace { id: "northwind" | "harbor"; people: Record<string, string>; types: TypeDef[] }
export const northwind: PageSpace = { id: "northwind", people: { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_docs: "Docs", agt_intake: "Intake" }, types: [CLIENT, PROJECT] };
export const harbor: PageSpace = { id: "harbor", people: { usr_irfad: "Irfad Imtiaz", usr_ines: "Ines Costa" }, types: [{ ...CLIENT, fields: CLIENT.fields.filter((x) => !["tax", "id_doc", "rating"].includes(x.key)) }, PROJECT] };

const client = (i: number): RecordRow => ({
  id: `cl_${i}`, type: "clients", version: 3, label: 1, createdAt: SAMPLE_NOW - 40 * DAY, updatedAt: SAMPLE_NOW - 2 * DAY, holds: 0,
  fields: {
    name: NAMES[i % NAMES.length]!, status: "active", owner: "usr_maya", value: { amount: 24000 + i * 1000, currency: "USD" }, due: SAMPLE_NOW + 6 * DAY, company: `${NAMES[i % NAMES.length]!.split(" ")[1]} Holdings`,
    email: `${NAMES[i % NAMES.length]!.split(" ")[0]!.toLowerCase()}@example.test`, rating: 4, active: i === 0, projects: i === 0 ? ["pj_0", "pj_1"] : ["pj_2"],
    notes: i === 0 ? "Prefers email. Started with [[Rivera engagement]] and the follow-up [[Rivera matter]]. See also [[Nobody Known]]." : "",
  },
});
const project = (i: number): RecordRow => ({
  id: `pj_${i}`, type: "projects", version: 1, label: 1, createdAt: SAMPLE_NOW - 30 * DAY, updatedAt: SAMPLE_NOW - DAY, holds: 0,
  fields: { name: PROJECTS[i]!, status: i === 0 ? "active" : "planning", lead: "usr_omar", due: SAMPLE_NOW + (10 + i) * DAY, budget: { amount: 8000 + i * 2500, currency: "USD" }, client: [i < 2 ? "cl_0" : "cl_1"] },
});

export interface SamplePage {
  data: RecordPageData;
  replica: FakeReplica;
  /** every capability the page called, in order */
  calls: { cap: string; input: unknown }[];
  opened: string[];
  /** the page choices written */
  prefs: { folded: string[]; keepVisible: string[] };
  /** An agent answers a comment thread the way the Space does: its reply lands under the root and its "is replying" clears. */
  agentReply(rootId: string, agentId: string, text: string): void;
  /** What was stored by Attach: file names by folder. */
  attached: { folderId: string; name: string }[];
}

export function createSamplePage(space: PageSpace = northwind, o: { fail?: string; prefs?: { folded: string[]; keepVisible: string[] } } = {}): SamplePage {
  const replica = createFakeReplica(space.id);
  const calls: SamplePage["calls"] = [];
  const opened: string[] = [];
  const prefs = o.prefs ? { folded: [...o.prefs.folded], keepVisible: [...o.prefs.keepVisible] } : { folded: [] as string[], keepVisible: [] as string[] };
  const own = (r: RecordRow): Row => ({ ...r, id: r.id }) as unknown as Row;
  replica.put("records:clients", [0, 1, 2].map((i) => own(client(i))));
  replica.put("records:projects", [0, 1, 2].map((i) => own(project(i))));
  // what happened to Elena Rivera so far, oldest first (the Activity tab reads it newest first)
  const seeded: { field: string; value: unknown; actor: string; reason?: string; ago: number }[] = [
    { field: "name", value: "Elena Rivera", actor: "usr_maya", reason: "Created", ago: 40 * DAY },
    { field: "status", value: "lead", actor: "usr_maya", ago: 39 * DAY },
    { field: "company", value: "Rivera Holdings", actor: "usr_omar", ago: 30 * DAY },
    { field: "status", value: "active", actor: "usr_maya", reason: "Signed the retainer", ago: 12 * DAY },
    { field: "due", value: SAMPLE_NOW + 6 * DAY, actor: "agt_docs", reason: "Moved the next step", ago: 2 * DAY },
  ];
  replica.put("history", seeded.map((e, n) => ({ id: `h_seed${n}`, recordId: "cl_0", field: e.field, value: e.value, hlc: `${SAMPLE_NOW - e.ago}:0`, actor: e.actor, ...(e.reason ? { reason: e.reason } : {}) })) as unknown as Row[]);
  replica.put("versions", [{ id: "cl_0:1", recordId: "cl_0", versionId: "ver_1", n: 1, by: "usr_maya", at: SAMPLE_NOW - 40 * DAY, reason: "Created" }, { id: "cl_0:2", recordId: "cl_0", versionId: "ver_2", n: 2, by: "usr_maya", at: SAMPLE_NOW - 12 * DAY, reason: "Signed the retainer" }, { id: "cl_0:3", recordId: "cl_0", versionId: "ver_3", n: 3, by: "usr_irfad", at: SAMPLE_NOW - 2 * DAY, reason: "Moved the next step" }] as unknown as Row[]);
  replica.put("facts", [{ id: "f1", factId: "f1", layer: "project", ownerRef: "usr_maya", text: "Elena prefers email over phone calls", validFrom: SAMPLE_NOW - 10 * DAY, learnedAt: SAMPLE_NOW - 3 * 3_600_000, sourceKind: "channel", sourceRef: "ch_rivera", sourceLink: "/chats/ch_rivera", status: "current", subject: "cl_0" }] as unknown as Row[]);
  const typeOf = (k: string): TypeDef | undefined => space.types.find((t) => t.key === k);
  const rowsOf = (type: string): RecordRow[] => replica.rows(`records:${type}`) as unknown as RecordRow[];

  replica.resolve("records.get", (_t, i: CapMap["records.get"]["in"]) => { return { record: rowsOf(i.type).find((x) => x.id === i.recordId) as never }; });
  replica.resolve("schema.describe", (_t, i: CapMap["schema.describe"]["in"]) => ({ types: space.types.filter((t) => !i.type || t.key === i.type) }));
  replica.resolve("schema.layout.get", (_t, i: CapMap["schema.layout.get"]["in"]) => LAYOUT[i.type] ?? { sections: [] });
  replica.resolve("records.page_prefs.get", () => ({ folded: [...prefs.folded], keepVisible: [...prefs.keepVisible] }));
  replica.resolve("records.completeness", (_t, i: CapMap["records.completeness"]["in"]) => {
    const t = typeOf(i.type), r = rowsOf(i.type).find((x) => x.id === i.recordId);
    if (!t || !r) return { filled: 0, total: 0, missing: [] };
    const asked = t.fields.filter((x) => x.type !== "files" && x.type !== "sealed" && x.type !== "longtext");
    const missing = asked.filter((x) => { const v = r.fields[x.key]; return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0); });
    return { filled: asked.length - missing.length, total: asked.length, missing: missing.map((x) => ({ field: x.key, title: x.title })) };
  });
  replica.resolve("records.relations_map", (_t, i: CapMap["records.relations_map"]["in"]) => {
    const t0 = typeOf(i.type), r0 = rowsOf(i.type).find((x) => x.id === i.recordId);
    const nodes: RelNode[] = [], edges: { from: string; to: string; field: string }[] = [];
    if (!t0 || !r0) return { nodes, edges };
    const title = (t: TypeDef, r: RecordRow): string => String(r.fields[t.titleField] ?? r.id);
    nodes.push({ recordId: r0.id, type: i.type, title: title(t0, r0), hop: 0 });
    const seen = new Set([r0.id]);
    const walk = (t: TypeDef, r: RecordRow, hop: number): void => {
      if (hop > (i.hops ?? 2)) return;
      for (const fd of t.fields) {
        if (fd.type !== "relation") continue;
        const target = typeOf(String(fd.options?.["to"] ?? ""));
        if (!target) continue;
        const v = r.fields[fd.key];
        for (const id of Array.isArray(v) ? (v as string[]) : []) {
          const tr = rowsOf(target.key).find((x) => x.id === id);
          if (!tr) continue;
          if (!seen.has(id)) { seen.add(id); nodes.push({ recordId: id, type: target.key, title: title(target, tr), hop }); edges.push({ from: r.id, to: id, field: fd.key }); walk(target, tr, hop + 1); }
        }
      }
    };
    walk(t0, r0, 1);
    return { nodes, edges };
  });
  replica.resolve("records.history", (t, i: CapMap["records.history"]["in"]) => ({ entries: ([...(t.get("history")?.values() ?? [])] as unknown as (Entry & { recordId: string })[]).filter((e) => e.recordId === i.recordId).map(({ recordId: _r, ...e }) => e as Entry).reverse() }));
  replica.resolve("records.versions", (t, i: CapMap["records.versions"]["in"]) => ({ versions: ([...(t.get("versions")?.values() ?? [])] as unknown as (Version & { recordId: string })[]).filter((v) => v.recordId === i.recordId).map(({ recordId: _r, ...v }) => v as Version) }));
  replica.resolve("memory.find_by_subject", (t, i: CapMap["memory.find_by_subject"]["in"]) => ({ facts: ([...(t.get("facts")?.values() ?? [])] as unknown as (CapMap["memory.find_by_subject"]["out"]["facts"][number] & { subject: string })[]).filter((x) => x.subject === i.subject).map(({ subject: _s, ...x }) => x as CapMap["memory.find_by_subject"]["out"]["facts"][number]), notes: [] }));

  // the Files reads of a record's folder: folders by id, and the files and folders inside one
  replica.resolve("files.folder.get", (t, i: CapMap["files.folder.get"]["in"]) => ({ folder: t.get("folders")?.get(i.folderId) as never }));
  replica.resolve("files.list", (t, i: CapMap["files.list"]["in"]) => ({ files: ([...(t.get("files")?.values() ?? [])] as unknown as Array<{ folderId: string }>).filter((x) => x.folderId === i.folder) as never, folders: [] }));

  // the Activity tab: the same history rows read as what happened, newest first, each field change with the value it replaced
  replica.resolve("records.activity", (t, i: CapMap["records.activity"]["in"]) => {
    const t0 = typeOf(i.type);
    const mine = ([...(t.get("history")?.values() ?? [])] as unknown as (Entry & { recordId: string; id: string })[]).filter((e) => e.recordId === i.recordId);
    const at = (e: Entry): number => Number(e.hlc.split(":")[0]);
    mine.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
    const last = new Map<string, unknown>();
    const out: CapMap["records.activity"]["out"]["entries"] = [];
    for (const e of mine) {
      const kind = e.reason === "Created" ? "created" : t0?.fields.find((x) => x.key === e.field)?.type === "relation" ? "linked" : "edited";
      out.push({ id: `${e.id}`, kind, at: at(e), actor: e.actor, ...(kind === "created" ? {} : { field: e.field, from: last.get(e.field) ?? null, to: e.value }) } as never);
      last.set(e.field, e.value);
    }
    out.reverse();
    const limit = i.limit ?? 50;
    return { entries: out.slice(0, limit), ...(out.length > limit ? { next: out[limit - 1]!.at } : {}) };
  });
  type Cmt = CapMap["records.comments.list"]["out"]["comments"][number];
  let cmt = 0;
  replica.resolve("records.comments.list", (t, i: CapMap["records.comments.list"]["in"]) => {
    const all = ([...(t.get("comments")?.values() ?? [])] as unknown as (Cmt & { gone?: boolean })[]).filter((c) => c.recordId === i.recordId && !c.gone).sort((a, b) => a.at - b.at || a.commentId.localeCompare(b.commentId));
    const resolvedRoots = new Set(all.filter((c) => c.parentId === undefined && c.resolved).map((c) => c.commentId));
    const shown = i.includeResolved === true ? all : all.filter((c) => !resolvedRoots.has(c.parentId ?? c.commentId));
    return { comments: shown as never, resolvedCount: resolvedRoots.size };
  });
  const comment = (id: string): (Cmt & { id: string }) | undefined => (replica.rows("comments") as unknown as (Cmt & { id: string })[]).find((c) => c.commentId === id);
  const putComment = (c: Cmt): void => replica.put("comments", [{ ...c, id: c.commentId }] as unknown as Row[]);
  const rootOfComment = (c: Cmt): Cmt => (c.parentId ? comment(c.parentId) ?? c : c);
  const attached: { folderId: string; name: string }[] = [];

  let hist = 0;
  const writes: Record<string, (i: never) => unknown> = {
    "records.update": (i: { type: string; recordId: string; patch: Record<string, unknown>; baseVersion?: number }) => {
      const r = rowsOf(i.type).find((x) => x.id === i.recordId);
      if (!r) throw new Error("record not found");
      if (i.baseVersion !== undefined && i.baseVersion !== r.version) throw new Error("changed by someone else");
      const next = { ...r, version: r.version + 1, updatedAt: SAMPLE_NOW, fields: { ...r.fields, ...i.patch } };
      replica.put(`records:${i.type}`, [own(next)]);
      for (const [k, v] of Object.entries(i.patch)) replica.put("history", [{ id: `h${++hist}`, recordId: i.recordId, field: k, value: v, hlc: `${SAMPLE_NOW}:${hist}`, actor: "usr_irfad" }] as unknown as Row[]);
      replica.put("versions", [{ id: `${i.recordId}:${next.version}`, recordId: i.recordId, versionId: `ver_${next.version}`, n: next.version, by: "usr_irfad", at: SAMPLE_NOW, reason: "Edited on the page" }] as unknown as Row[]);
      return { record: next };
    },
    "records.page_prefs.set": (i: { folded?: string[]; keepVisible?: string[] }) => {
      if (i.folded) prefs.folded = [...i.folded];
      if (i.keepVisible) prefs.keepVisible = [...i.keepVisible];
      replica.put("prefs", [{ id: "p", n: (replica.rows("prefs").length + 1) }] as unknown as Row[]);
      return { folded: [...prefs.folded], keepVisible: [...prefs.keepVisible] };
    },
    "records.comments.add": (i: { type: string; recordId: string; text: string; parentId?: string; mentions?: { kind: "person" | "agent"; id: string }[] }) => {
      const parent = i.parentId ? comment(i.parentId) : undefined;
      const root = parent ? rootOfComment(parent) : undefined;
      const mentions = i.mentions ?? [];
      const c: Cmt = {
        commentId: `rcm_${++cmt}`, type: i.type, recordId: i.recordId, ...(root ? { parentId: root.commentId } : {}), text: i.text, by: "usr_irfad", at: SAMPLE_NOW + cmt * 1000, resolved: false, mentions,
        replying: mentions.filter((m) => m.kind === "agent").map((m) => m.id),
      };
      putComment(c);
      return { comment: c };
    },
    "records.comments.edit": (i: { commentId: string; text: string }) => {
      const c = comment(i.commentId);
      if (!c) throw new Error("no such comment");
      if (c.by !== "usr_irfad") throw new Error("only your own");
      const next = { ...c, text: i.text, editedAt: SAMPLE_NOW + 5000 };
      putComment(next);
      return { comment: next };
    },
    "records.comments.resolve": (i: { commentId: string; resolved: boolean }) => {
      const c = comment(i.commentId);
      if (!c) throw new Error("no such comment");
      const root = rootOfComment(c);
      const next: Cmt = { ...root, resolved: i.resolved, ...(i.resolved ? { resolvedBy: "usr_irfad" } : {}) };
      if (!i.resolved) delete (next as { resolvedBy?: string }).resolvedBy;
      putComment(next);
      return { comment: next };
    },
    "records.comments.delete": (i: { commentId: string }) => {
      const c = comment(i.commentId);
      if (!c) return { deleted: false };
      for (const x of replica.rows("comments") as unknown as (Cmt & { id: string })[]) if (x.commentId === c.commentId || x.parentId === c.commentId) replica.put("comments", [{ ...x, gone: true }] as unknown as Row[]);
      return { deleted: true };
    },
    "records.value_source": () => ({ source: { kind: "agent", actor: "Docs", at: SAMPLE_NOW - DAY, state: "counted" } }),
  };
  const data: RecordPageData = {
    live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> { return liveQuery(replica, cap, input); },
    async call(cap, input) {
      calls.push({ cap, input });
      if (o.fail && cap === "records.update") throw new Error(o.fail);
      const w = writes[cap];
      if (!w) throw new Error(`unknown capability ${cap}`);
      return w(input as never);
    },
    now: () => SAMPLE_NOW, nameOf: (id) => space.people[id] ?? id,
    me: { id: "usr_irfad", name: space.people["usr_irfad"] ?? "Irfad" },
    mentionables: () => Object.entries(space.people).filter(([id]) => id !== "usr_irfad").map(([id, name]) => ({ id, name, kind: id.startsWith("agt_") ? ("agent" as const) : ("person" as const), ...(id.startsWith("agt_") ? { sub: "Agent" } : {}) })),
    renderChat: (type, id) => createElement(Text, { testID: "sample-chat" }, `Ask pane for ${type} ${id}`),
    files: {
      folderOf: async (t) => (replica.rows("folders") as unknown as { id: string; forRecord?: string }[]).find((f) => f.forRecord === t.recordId)?.id ?? null,
      attach: async (files, t) => {
        const found = (replica.rows("folders") as unknown as { id: string; forRecord?: string }[]).find((f) => f.forRecord === t.recordId);
        const folderId = found?.id ?? `fld_rec_${t.recordId}`;
        if (!found) replica.put("folders", [{ id: folderId, folderId, name: t.title, path: `/Record files/${t.title}`, forRecord: t.recordId }] as unknown as Row[]);
        for (const f of files) {
          attached.push({ folderId, name: f.name });
          replica.put("files", [{ id: `fil_${attached.length}`, fileId: `fil_${attached.length}`, folderId, name: f.name, kind: "file", size: 2048 * attached.length }] as unknown as Row[]);
        }
        return folderId;
      },
    },
    nav: { openFile: (id) => void opened.push(`file:${id}`), openRecord: (t, id) => void opened.push(`record:${t}:${id}`), openChat: (t, id) => void opened.push(`chat:${t}:${id}`), askFor: (x) => void opened.push(`ask:${x.type}:${x.recordId}:${x.contact.contactId}:${x.missing.map((m) => m.field).join(",")}`), openFiles: (t, id) => void opened.push(`files:${t}:${id}`), openSource: (l) => void opened.push(`source:${l}`) },
  };
  const agentReply = (rootId: string, agentId: string, text: string): void => {
    const root = comment(rootId);
    if (!root) throw new Error("no such thread");
    for (const c of replica.rows("comments") as unknown as (Cmt & { id: string })[]) if (c.commentId === rootId || c.parentId === rootId) putComment({ ...c, replying: c.replying.filter((a) => a !== agentId) });
    putComment({ commentId: `rcm_${++cmt}`, type: root.type, recordId: root.recordId, parentId: rootId, text, by: agentId, at: SAMPLE_NOW + cmt * 1000, resolved: false, mentions: [], replying: [] });
  };
  return { data, replica, calls, opened, prefs, agentReply, attached };
}
