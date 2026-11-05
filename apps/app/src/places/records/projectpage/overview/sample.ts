// The stand-in behind the Overview's tests and screenshots: the projects.overview_doc.* capabilities and projects.live_block.query answered from memory, with revisions, Undo, templates, one editable
// property, and rows a reader may not open. An agent's edit is made by `agentEdits(summary, markdown)`. The values are made up.
import type { ProjectPageData } from "../data.tsx";
import type { OverviewDoc, PageTemplate, Revision, LiveOut } from "./model.ts";

export const NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_docs: "Docs", agt_assistant: "Assistant" };

export const PAGE = [
  "<!--b:blk_a1-->", "# Rivera account", "",
  "<!--b:blk_b2-->", "Elena Rivera's engagement: letter, signature, billing, kickoff.", "",
  "<!--b:blk_c3-->", ':::live {"type":"tasks","spec":{"title":"Open tasks","status":"open"},"view":"list"}', "",
  "<!--b:blk_d4-->", ':::live {"type":"records","spec":{"title":"Invoices","type":"invoice"},"view":"table"}', "",
].join("\n");
const OTHER = ["<!--b:blk_t1-->", "# Hiring", "", "<!--b:blk_t2-->", "The role, the plan, the candidates.", ""].join("\n");

export interface SampleOverview {
  data: ProjectPageData;
  calls: { cap: string; input: unknown }[];
  opened: string[];
  /** An agent saves the page (its own revision, authored by the agent). */
  agentEdits(summary: string, markdown: string): void;
  /** Another writer moves the revision on, so the next save here is stale. */
  racing(): void;
  state(): { markdown: string; rev: number; props: Record<string, string>; revisions: Revision[] };
  failNext(cap: string, code?: string, message?: string): void;
  changed(): void;
}

export function createSampleOverview(o: { markdown?: string } = {}): SampleOverview {
  let markdown = o.markdown ?? PAGE;
  let rev = 1;
  const revs: (Revision & { before: string })[] = [{ rev: 1, by: "usr_maya", authorKind: "person", summary: "started from the Client account template", at: NOW - 3 * 3_600_000, before: markdown }];
  const agentBlocks = new Set<string>();
  let agentAt = 0;
  let props: Record<string, string> = { contract: "$48,000", repo: "" };
  const calls: SampleOverview["calls"] = [];
  const opened: string[] = [];
  const fails = new Map<string, { code: string; message: string }>();
  const listeners = new Set<() => void>();
  const TEMPLATES: PageTemplate[] = [
    { templateId: "tpl_client_account", title: "Client account", summary: "A client's work in one place: invoices, mail, tasks and who is on it.", blocks: 9, builtin: true, by: "system", at: 1 },
    { templateId: "tpl_software_project", title: "Software project", summary: "Pull requests, CI, tasks and milestones for a code project.", blocks: 10, builtin: true, by: "system", at: 2 },
    { templateId: "tpl_hiring", title: "Hiring", summary: "Candidates, interviews and the people running the search.", blocks: 9, builtin: true, by: "system", at: 3 },
  ];
  const blocksOf = (md: string): OverviewDoc["blocks"] => md.split(/\n\n+/).filter((c) => c.trim() !== "").map((c, i) => {
    const id = /^<!--b:(\w+)-->/.exec(c)?.[1] ?? `blk_new${i}`;
    const by = agentBlocks.has(id) ? { by: "agt_docs", at: agentAt } : {};
    const body = c.replace(/^<!--b:\w+-->\n?/, "");
    const live = /^:::live (\{.*\})$/s.exec(body);
    if (live) { const j = JSON.parse(live[1]!) as { type: string; spec: unknown; view?: string }; return { id, kind: "live" as const, live: { type: j.type, spec: j.spec as never, view: j.view } as never, ...by }; }
    const h = /^(#{1,3}) (.*)$/.exec(body);
    return h ? { id, kind: "heading" as const, level: h[1]!.length, text: h[2]! } : { id, kind: "text" as const, text: body };
  });
  const live = (type: string, spec: Record<string, unknown>): LiveOut => {
    if (type === "tasks") return { type: "tasks", total: 6, hidden: 2, rows: [{ id: "t3", url: "/tasks/t3", title: "Draft the engagement letter", state: "doing", who: "agt_docs", due: Date.UTC(2025, 9, 28) }, { id: "t4", url: "/tasks/t4", title: "Send the letter for signature", state: "todo", who: "usr_maya", due: Date.UTC(2025, 9, 22) }, { id: "t5", url: "/tasks/t5", title: "Consult on Tuesday", state: "todo", who: "usr_omar", due: Date.UTC(2025, 9, 29) }, { id: "t6", url: "/tasks/t6", title: "Review the signed letter", state: "in_review", who: "usr_maya" }] };
    if (type === "records") return { type: "records", total: 3, hidden: 0, rows: [{ id: "inv104", title: "INV-104", state: "open", detail: "$4,200" }, { id: "inv105", title: "INV-105", state: "paid", detail: "$1,150" }, { id: "inv106", title: "INV-106", state: "overdue", detail: "$900" }] };
    if (type === "metric") return { type: "metric", total: 3, hidden: 0, rows: [], value: spec["op"] === "sum" ? 6250 : 3, label: String(spec["title"] ?? "Count") };
    return { type: type as LiveOut["type"], total: 1, hidden: 0, rows: [{ id: `${type}1`, title: `A ${type} item`, state: "ok" }] };
  };
  const doc = (): OverviewDoc => {
    const last = revs[revs.length - 1]!;
    return { rev, blocks: blocksOf(markdown), markdown, properties: [{ key: "contract", title: "Contract value", type: "text", value: props["contract"] }, { key: "repo", title: "Repo", type: "text", value: props["repo"] || null }] as never, latest: { rev: last.rev, by: last.by, authorKind: last.authorKind, summary: last.summary, at: last.at, ...(last.undoOf !== undefined ? { undoOf: last.undoOf } : {}) }, updatedAt: last.at, updatedBy: last.by } as OverviewDoc;
  };
  const snaps = new Map<number, string>([[1, markdown]]);
  const restoreAt = (r: number): string => snaps.get(r) ?? markdown;
  const push = (by: string, kind: "person" | "agent", summary: string, md: string, undoOf?: number): number => {
    revs.push({ rev: rev + 1, by, authorKind: kind, summary, at: NOW + revs.length * 60_000, before: markdown, ...(undoOf !== undefined ? { undoOf } : {}) });
    rev += 1; markdown = md; snaps.set(rev, md); return rev;
  };
  const fail = (cap: string): void => { const f = fails.get(cap); if (f) { fails.delete(cap); throw Object.assign(new Error(f.message), { code: f.code, details: { reason: "stale_revision" } }); } };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input });
    fail(cap);
    const i = (input ?? {}) as Record<string, unknown>;
    switch (cap) {
      case "projects.overview_doc.get": return doc();
      case "projects.overview": return { project: { projectId: "prj_rivera", recordId: "rec_p", type: "project", title: "Rivera account", status: "active", lead: "usr_maya", start: Date.UTC(2025, 9, 1), due: Date.UTC(2025, 11, 15), channelId: "chn_1", folderId: "fld_1", memberCount: 4, openTasks: 6, lateTasks: 1, health: "risk" } };
      case "projects.overview_doc.history": return { revisions: [...revs].reverse().map(({ before, ...r }) => { void before; return r; }) };
      case "projects.overview_doc.save": {
        if (i["baseRev"] !== rev) throw Object.assign(new Error("Someone changed the page since you opened it."), { code: "validation.precondition_failed", details: { reason: "stale_revision", rev } });
        const md = String(i["markdown"]);
        const lives = (s: string): number => (s.match(/:::live/g) ?? []).length;
        const said = lives(md) > lives(markdown) ? "added a live block" : lives(md) < lives(markdown) ? "removed a live block" : md === markdown ? "no change" : "edited a paragraph";
        const r = push("usr_irfad", "person", said, md);
        return { rev: r, blocks: blocksOf(markdown), markdown };
      }
      case "projects.overview_doc.undo": {
        const last = revs[revs.length - 1]!;
        if (i["rev"] !== last.rev) throw Object.assign(new Error("Only the latest change can be undone."), { code: "validation.precondition_failed", details: { reason: "not_latest" } });
        const r = push("usr_irfad", "person", `undid: ${last.summary}`, last.before, last.rev);
        return { rev: r, undid: last.rev, blocks: blocksOf(markdown) };
      }
      case "projects.overview_doc.restore": {
        const target = revs.find((r) => r.rev === i["rev"]);
        if (!target) throw Object.assign(new Error("That version is no longer kept."), { code: "validation.not_found" });
        if (i["baseRev"] !== undefined && i["baseRev"] !== rev) throw Object.assign(new Error("stale"), { code: "validation.precondition_failed", details: { reason: "stale_revision" } });
        const r = push("usr_irfad", "person", `restored version ${target.rev}`, restoreAt(target.rev));
        return { rev: r, restored: target.rev, blocks: blocksOf(markdown) };
      }
      case "projects.overview_doc.templates.list": return { templates: TEMPLATES };
      case "projects.overview_doc.apply_template": {
        if (i["baseRev"] !== rev) throw Object.assign(new Error("stale"), { code: "validation.precondition_failed", details: { reason: "stale_revision" } });
        const t = TEMPLATES.find((x) => x.templateId === i["templateId"])!;
        const r = push("usr_irfad", "person", `applied the ${t.title} template`, t.templateId === "tpl_hiring" ? OTHER : PAGE);
        return { rev: r, blocks: blocksOf(markdown) };
      }
      case "projects.overview_doc.templates.save": { const t = { templateId: `tpl_${TEMPLATES.length + 1}`, title: String(i["title"]), blocks: 4, builtin: false, by: "usr_irfad", at: NOW }; TEMPLATES.push(t); return { template: t }; }
      case "projects.overview_edit": {
        const op = (i["ops"] as { op: string; key: string; value: unknown }[])[0]!;
        props = { ...props, [op.key]: op.value === null ? "" : String(op.value) };
        push("usr_irfad", "person", `set ${op.key === "contract" ? "Contract value" : "Repo"}`, markdown);
        return { rev, summary: "set a property", blocks: blocksOf(markdown) };
      }
      case "projects.live_block.query": return live(String(i["type"]), (i["spec"] ?? {}) as Record<string, unknown>);
      case "schema.types.get": return { type: { key: i["type"], title: "Invoice", plural: "Invoices", fields: [{ key: "amount", type: "currency", options: { currency: "USD" } }] } };
      case "schema.types.list": return { types: [{ key: "invoice", title: "Invoice", plural: "Invoices" }, { key: "contact", title: "Person", plural: "People" }] };
      default: throw new Error(`the sample does not answer ${cap}`);
    }
  };
  const data: ProjectPageData = {
    call, nameOf: (id) => NAMES[id] ?? id, me: { id: "usr_irfad", name: "Irfad Imtiaz" }, now: () => NOW + 3_600_000,
    nav: { openChannel: (c) => opened.push(`channel:${c}`), openThread: (t) => opened.push(`thread:${t}`), openFolder: (f) => opened.push(`folder:${f}`), openFile: (f) => opened.push(`file:${f}`), openRecord: (t, r) => opened.push(`record:${t}:${r}`), openRecordPage: (t, r) => opened.push(`page:${t}:${r}`), openGoal: (g) => opened.push(`goal:${g}`) },
    changes: { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } },
  };
  return {
    data, calls, opened,
    agentEdits: (summary, md) => { const before = new Set(blocksOf(markdown).map((b) => b.id)); push("agt_docs", "agent", summary, md); agentAt = revs[revs.length - 1]!.at; for (const b of blocksOf(md)) if (!before.has(b.id)) agentBlocks.add(b.id); },
    racing: () => { push("usr_maya", "person", "edited the page", markdown); },
    state: () => ({ markdown, rev, props, revisions: revs.map(({ before, ...r }) => { void before; return r; }) }),
    failNext: (cap, code = "internal.unexpected", message = "That did not work.") => { fails.set(cap, { code, message }); },
    changed: () => { for (const l of listeners) l(); },
  };
}
