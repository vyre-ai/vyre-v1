// Projects, the Overview as a page people and agents both edit (owner, 4 Nov 2026), for any kind of project.
// The page is a list of blocks: text, headings, and live blocks that store only a spec (never the data) and are evaluated when the page is read, through the reader's own access, with a count of the rows
// they may not open. The project is a record, so its custom fields come from the records schema and show in the page header. Every change is a revision with its author and can be undone; an edit is
// audited, fires an event, and an agent's edit leaves one quiet line in the project channel. Agents read the page as Markdown with block ids (overview_get) and edit it by ops (overview_edit).
// DECISION: the notes module here is a Keep-style note with no block document, collaboration or history, so the page lives in this module: its blocks, and a log of revisions. Two writers are kept apart by
// the revision they based their change on, not by live merging.
import {
  LIVE_TYPES, revBlocks, attachesOf, call, clean, codeOf, docOf, emitP, ensure, isOpenState, loadTasks, me, membersOf, newId, planTask, plansOf, projectRow, raise, readRecord, revsOf, saveDoc, saveTemplate,
  templateBy, templatesOf, tolerant, visible, writeRecord,
} from "../projections.ts";
import type { In, LiveType, PageBlock, Project, ProjectsCtx, RevRow } from "../projections.ts";
import { liveOf } from "./attach.ts";

const LIVE_VIEWS = ["list", "table", "count", "cards"] as const;
type View = (typeof LIVE_VIEWS)[number];

// ---- the starting pages ----

const live = (id: string, type: LiveType, spec: Record<string, unknown>, view: View = "list"): PageBlock => ({ id, kind: "live", live: { type, spec, view } });
const head = (id: string, text: string, level = 2): PageBlock => ({ id, kind: "heading", text, level });
const text = (id: string, t: string): PageBlock => ({ id, kind: "text", text: t });

/** A page for a project that never had one: how it stands, what is next, who is on it. */
export const defaultBlocks = (): PageBlock[] => [
  live("blk_status", "status", { title: "Status" }), head("blk_h_next", "Next"), live("blk_next", "milestones", { title: "Next milestones", limit: 3 }),
  head("blk_h_work", "Late or waiting"), live("blk_open", "tasks", { title: "Open tasks", status: "late" }), head("blk_h_people", "People and agents"), live("blk_people", "people", { title: "People and agents" }),
];

export interface Builtin { templateId: string; title: string; summary: string; blocks: PageBlock[] }
export const BUILTIN_TEMPLATES: readonly Builtin[] = [
  {
    templateId: "tpl_client_account", title: "Client account", summary: "A client's work in one place: invoices, mail, tasks and who is on it.",
    blocks: [
      live("b_status", "status", { title: "Status" }), head("b_h_about", "About this client"), text("b_about", "Who they are, what we do for them, and what to watch."),
      head("b_h_inv", "Invoices"), live("b_inv", "records", { title: "Invoices", type: "invoice" }, "table"), live("b_owed", "metric", { title: "Unpaid", type: "invoice", op: "sum", field: "amount", filter: { field: "status", op: "eq", value: "sent" } }, "count"),
      head("b_h_mail", "Mail"), live("b_mail", "links", { title: "Mail threads", kind: "mail_thread" }), head("b_h_tasks", "Work"), live("b_tasks", "tasks", { title: "Open tasks", status: "open" }),
      live("b_next", "milestones", { title: "Next milestones", limit: 3 }), head("b_h_people", "People and agents"), live("b_people", "people", { title: "People and agents" }),
    ],
  },
  {
    templateId: "tpl_software_project", title: "Software project", summary: "Pull requests, CI, tasks and milestones for a code project.",
    blocks: [
      live("b_status", "status", { title: "Status" }), head("b_h_goal", "Goal"), live("b_goal", "goal", { title: "Goal" }), head("b_h_code", "Code"),
      live("b_prs", "links", { title: "Pull requests", kind: "github.pr" }), live("b_ci", "ci", { title: "CI runs" }), head("b_h_work", "Work"), live("b_tasks", "tasks", { title: "Open tasks", status: "open" }),
      live("b_next", "milestones", { title: "Next milestones", limit: 3 }), head("b_h_people", "People and agents"), live("b_people", "people", { title: "People and agents" }),
    ],
  },
  {
    templateId: "tpl_hiring", title: "Hiring", summary: "Candidates, interviews and the people running the search.",
    blocks: [
      live("b_status", "status", { title: "Status" }), head("b_h_role", "The role"), text("b_role", "What the role is, what good looks like, and the pay range."),
      head("b_h_cand", "Candidates"), live("b_cand", "records", { title: "Candidates", type: "candidate" }, "table"), live("b_count", "metric", { title: "Candidates in the pipeline", type: "candidate", op: "count" }, "count"),
      head("b_h_int", "Interviews"), live("b_cal", "links", { title: "Interviews", kind: "calendar_event" }), live("b_tasks", "tasks", { title: "Open tasks", status: "open" }), head("b_h_people", "People and agents"), live("b_people", "people", { title: "People and agents" }),
    ],
  },
];

/** The built-in templates are in the Space's template list from the first read. */
export function seedTemplates(ctx: ProjectsCtx): void {
  BUILTIN_TEMPLATES.forEach((b, i) => { if (!templateBy(ctx.db, b.templateId)) saveTemplate(ctx.db, { templateId: b.templateId, title: b.title, summary: b.summary, blocks: b.blocks, builtin: true, by: "system", at: ctx.now() + i }); });
}

/** A template's blocks for a page: new ids, authored by whoever applies it. */
function fresh(ctx: ProjectsCtx, blocks: readonly PageBlock[]): PageBlock[] {
  return blocks.map((b) => ({ ...b, id: newId("blk", ctx.now()), by: me(ctx), at: ctx.now(), ...(b.live ? { live: { ...b.live, spec: { ...b.live.spec } } } : {}) }));
}

/** A new project's first page, from a template: its blocks as revision 1. The project is not yet a resource in access when its creating call runs, so this writes the page directly. */
export function startPage(ctx: ProjectsCtx, projectId: string, templateId: string): void {
  const tpl = templateBy(ctx.db, templateId);
  if (!tpl) return;
  const blocks = fresh(ctx, tpl.blocks);
  saveDoc(ctx.db, projectId, { blocks, before: [], by: me(ctx), authorKind: ctx.principal.kind === "agent" ? "agent" : "person", summary: `started from the ${tpl.title} template`, at: ctx.now() });
}

// ---- reading the page ----

const PROTECTED = new Set(["title", "summary", "status", "lead", "start", "due", "goal", "status_update", "status_update_at", "stages", "channel", "folder", "pinned_files"]);
interface FieldDef { key: string; title?: string; type?: string; options?: unknown }

async function customFields(ctx: ProjectsCtx, p: Project): Promise<FieldDef[]> {
  const got = await tolerant<{ type?: { fields?: FieldDef[] } }>(ctx, "schema.types.get", { type: p.type }, {});
  return (got.type?.fields ?? []).filter((f) => !PROTECTED.has(f.key));
}

async function properties(ctx: ProjectsCtx, p: Project): Promise<Array<{ key: string; title: string; type: string; value?: unknown }>> {
  const [defs, fields] = await Promise.all([customFields(ctx, p), readRecord(ctx, p).catch(() => ({} as Record<string, unknown>))]);
  return defs.map((d) => clean({ key: d.key, title: d.title ?? d.key, type: d.type ?? "text", value: fields[d.key] }));
}

const withAuthor = (b: PageBlock, by: string, at: number): PageBlock => ({ ...b, by, at });
const view = (b: PageBlock) => clean({ id: b.id, kind: b.kind, text: b.text, level: b.level, live: b.live ? clean({ type: b.live.type, spec: b.live.spec, view: b.live.view }) : undefined, by: b.by, at: b.at });
const revView = (r: RevRow) => clean({ rev: r.rev, by: r.by, authorKind: r.authorKind, summary: r.summary, undoOf: r.undoOf, at: r.at });

export async function docGet(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  seedTemplates(ctx);
  const d = docOf(ctx.db, p.projectId);
  const revs = revsOf(ctx.db, p.projectId, 1);
  return clean({
    rev: d?.rev ?? 0, blocks: (d?.blocks ?? defaultBlocks()).map(view), markdown: toMarkdown(d?.blocks ?? defaultBlocks()), properties: await properties(ctx, p),
    updatedBy: d?.by, updatedAt: d?.at, latest: revs[0] ? revView(revs[0]) : undefined,
  });
}

export async function history(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  return { revisions: revsOf(ctx.db, p.projectId, Math.min(100, Math.max(1, Number(input.limit ?? 30)))).map(revView) };
}

// ---- changing it ----

function checkBlock(ctx: ProjectsCtx, b: In): Omit<PageBlock, "id"> {
  const kind = b?.kind;
  if (kind === "text" || kind === "heading") {
    if (typeof b.text !== "string") raise(ctx, "validation.bad_input", "A text block needs its text.");
    if (b.text.length > 20_000) raise(ctx, "validation.bad_input", "That block is too long.");
    return clean({ kind, text: b.text, level: kind === "heading" ? Math.min(3, Math.max(1, Number(b.level ?? 2))) : undefined }) as Omit<PageBlock, "id">;
  }
  if (kind === "live") return { kind, live: checkLive(ctx, b.live) };
  raise(ctx, "validation.bad_input", "A block is text, a heading or a live block.", { kind: String(kind) });
}
function checkLive(ctx: ProjectsCtx, l: In | undefined): NonNullable<PageBlock["live"]> {
  if (!l || !LIVE_TYPES.includes(l.type)) raise(ctx, "validation.bad_input", "That kind of live block does not exist.", { type: String(l?.type) });
  const spec = (l.spec && typeof l.spec === "object" && !Array.isArray(l.spec) ? l.spec : {}) as Record<string, unknown>;
  if (JSON.stringify(spec).length > 4000) raise(ctx, "validation.bad_input", "That block's settings are too long.");
  if ((l.type === "records" || l.type === "metric") && (typeof spec["type"] !== "string" || spec["type"] === "")) raise(ctx, "validation.bad_input", "Say which record type the block shows.", { type: l.type });
  if (l.type === "metric" && spec["op"] !== "count" && spec["op"] !== "sum") raise(ctx, "validation.bad_input", "A metric counts or sums.", { type: "metric" });
  if (l.type === "metric" && spec["op"] === "sum" && typeof spec["field"] !== "string") raise(ctx, "validation.bad_input", "A sum needs the field to add up.", { type: "metric" });
  if (l.type === "links" && spec["kind"] !== undefined && typeof spec["kind"] !== "string") raise(ctx, "validation.bad_input", "A links block takes a kind of link.", { type: "links" });
  const v = l.view === undefined ? undefined : (LIVE_VIEWS as readonly string[]).includes(l.view) ? (l.view as View) : raise(ctx, "validation.bad_input", "That view does not exist.", { view: String(l.view) });
  return clean({ type: l.type as LiveType, spec, view: v });
}

const liveName = (b: PageBlock): string => { const ti = (b.live?.spec as { title?: unknown } | undefined)?.title; return typeof ti === "string" && ti.trim() !== "" ? ` "${ti.trim().slice(0, 40)}"` : ""; };
const brief = (b: PageBlock): string => (b.kind === "live" ? `a live ${b.live!.type} block${liveName(b)}` : b.kind === "heading" ? `the heading "${(b.text ?? "").slice(0, 40)}"` : "a paragraph");

/** Apply ops to a page: answers the new blocks, a line saying what changed, and the property values the ops replaced. */
export async function applyOps(ctx: ProjectsCtx, p: Project, start: readonly PageBlock[], ops: readonly In[]): Promise<{ blocks: PageBlock[]; summary: string; props: Record<string, unknown>; changed: number }> {
  let blocks = start.map((b) => ({ ...b }));
  const said: string[] = [];
  const props: Record<string, unknown> = {};
  const by = me(ctx);
  const at = ctx.now();
  const find = (id: unknown): number => { const i = blocks.findIndex((b) => b.id === id); if (i < 0) raise(ctx, "validation.not_found", "That block is not on the page.", { blockId: String(id) }); return i; };
  const place = (after: unknown): number => (after === undefined || after === null || after === "end" ? blocks.length : after === "start" ? 0 : find(after) + 1);
  for (const op of ops) {
    switch (op.op) {
      case "insert": {
        const b = withAuthor({ id: newId("blk", at), ...checkBlock(ctx, op.block ?? {}) }, by, at);
        blocks.splice(place(op.after), 0, b);
        said.push(`added ${brief(b)}`);
        break;
      }
      case "update": {
        const i = find(op.id);
        const cur = blocks[i]!;
        const patch = op.block ?? {};
        const next = cur.kind === "live" && patch.live === undefined && patch.kind === undefined ? cur : { id: cur.id, ...checkBlock(ctx, { kind: cur.kind, ...(cur.kind === "live" ? {} : { text: cur.text, level: cur.level }), ...patch }) };
        blocks[i] = withAuthor(next, by, at);
        said.push(`changed ${brief(blocks[i]!)}`);
        break;
      }
      case "move": {
        const i = find(op.id);
        const [b] = blocks.splice(i, 1);
        blocks.splice(place(op.after), 0, withAuthor(b!, by, at));
        said.push(`moved ${brief(b!)}`);
        break;
      }
      case "delete": {
        const i = find(op.id);
        const [b] = blocks.splice(i, 1);
        said.push(`removed ${brief(b!)}`);
        break;
      }
      case "set_property": {
        const key = String(op.key ?? "");
        const defs = await customFields(ctx, p);
        if (!defs.some((d) => d.key === key)) raise(ctx, "validation.bad_input", "That property is not one of this project's fields. An admin adds fields in the Records settings.", { key });
        if (!(key in props)) props[key] = (await readRecord(ctx, p).catch(() => ({} as Record<string, unknown>)))[key] ?? null;
        await writeRecord(ctx, p, { [key]: op.value === undefined ? null : op.value });
        said.push(`set ${defs.find((d) => d.key === key)?.title ?? key}`);
        break;
      }
      default: raise(ctx, "validation.bad_input", "An edit is insert, update, move, delete or set_property.", { op: String(op.op) });
    }
  }
  if (blocks.length > 300) raise(ctx, "validation.bad_input", "A page holds at most 300 blocks.");
  return { blocks, summary: said.length === 0 ? "no change" : said.slice(0, 4).join(", ") + (said.length > 4 ? ` and ${said.length - 4} more` : ""), props, changed: said.length };
}

async function commit(ctx: ProjectsCtx, p: Project, before: readonly PageBlock[], r: { blocks: PageBlock[]; summary: string; props: Record<string, unknown> }, undoOf?: number): Promise<number> {
  const authorKind = ctx.principal.kind === "agent" ? "agent" : "person";
  const rev = saveDoc(ctx.db, p.projectId, { blocks: r.blocks, before: [...before], props: Object.keys(r.props).length ? r.props : undefined, by: me(ctx), authorKind, summary: r.summary, undoOf, at: ctx.now() });
  emitP(ctx, "project.overview_edited", p.projectId, clean({ rev, by: me(ctx), authorKind, summary: r.summary, undoOf }));
  return rev;
}

/** An agent's edit leaves one quiet line in the project channel: who changed what. */
async function say(ctx: ProjectsCtx, p: Project, summary: string): Promise<void> {
  if (ctx.principal.kind !== "agent" || !p.threadId) return;
  const who = await tolerant<{ agent?: { name?: string } }>(ctx, "agents.get", { agentId: ctx.principal.id }, {});
  try { await call(ctx, "chat.post", { threadId: p.threadId, body: `${who.agent?.name ?? "An agent"} edited the Overview: ${summary}.` }, { idempotencyKey: `prj-ov:${p.projectId}:${ctx.now()}:${summary.length}` }); } catch (e) {
    ctx.log.warn("projects: the Overview edit was kept but not mentioned in the channel", { project: p.projectId, error: codeOf(e) });
  }
}

function stale(ctx: ProjectsCtx, p: Project, baseRev: unknown): void {
  const cur = docOf(ctx.db, p.projectId)?.rev ?? 0;
  if (typeof baseRev === "number" && baseRev !== cur) raise(ctx, "validation.precondition_failed", "Someone changed the page since you opened it. Open it again and redo your change.", { reason: "stale_revision", rev: cur });
}

/** What a save changed, in a few words: which live block was added, removed or set differently, which text was written. */
export function describeChange(before: readonly PageBlock[], after: readonly PageBlock[]): string {
  const said: string[] = [];
  const was = new Map(before.map((b) => [b.id, b]));
  const now = new Map(after.map((b) => [b.id, b]));
  for (const b of after) {
    const o = was.get(b.id);
    if (!o) { said.push(`added ${brief(b)}`); continue; }
    if (JSON.stringify({ ...o, by: undefined, at: undefined }) === JSON.stringify({ ...b, by: undefined, at: undefined })) continue;
    if (b.kind === "live" && o.kind === "live") said.push(JSON.stringify(o.live!.spec) !== JSON.stringify(b.live!.spec) ? `changed the filter of ${(b.live!.spec as { title?: string }).title ?? b.live!.type}` : `changed the view of ${(b.live!.spec as { title?: string }).title ?? b.live!.type}`);
    else said.push(b.kind === "heading" ? `renamed the heading "${(b.text ?? "").slice(0, 40)}"` : "edited a paragraph");
  }
  for (const b of before) if (!now.has(b.id)) said.push(`removed ${brief(b)}`);
  if (said.length === 0) return before.map((b) => b.id).join() === after.map((b) => b.id).join() ? "no change" : "moved a block";
  return said.slice(0, 3).join(", ") + (said.length > 3 ? ` and ${said.length - 3} more` : "");
}

export async function docSave(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  stale(ctx, p, input.baseRev);
  const before = docOf(ctx.db, p.projectId)?.blocks ?? defaultBlocks();
  const known = new Map(before.map((b) => [b.id, b]));
  const at = ctx.now();
  if (input.markdown !== undefined && typeof input.markdown !== "string") raise(ctx, "validation.bad_input", "Send the page as text.");
  const fromText = typeof input.markdown === "string" ? fromMarkdown(ctx, input.markdown).map(({ fresh, ...b }) => { void fresh; return b; }) : undefined;
  const incoming: In[] = fromText ?? (Array.isArray(input.blocks) ? input.blocks : []);
  const blocks: PageBlock[] = incoming.map((raw: In): PageBlock => {
    const checked = checkBlock(ctx, raw);
    const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : newId("blk", at);
    const old = known.get(id);
    // a block whose content did not change keeps its author and time
    return old && JSON.stringify({ ...old, by: undefined, at: undefined }) === JSON.stringify({ id, ...checked }) ? old : withAuthor({ id, ...checked }, me(ctx), at);
  });
  if (blocks.length > 300) raise(ctx, "validation.bad_input", "A page holds at most 300 blocks.");
  const summary = JSON.stringify(blocks) === JSON.stringify(before) ? "no change" : describeChange(before, blocks);
  const rev = await commit(ctx, p, before, { blocks, summary, props: {} });
  return { rev, blocks: blocks.map(view), markdown: toMarkdown(blocks) };
}

export async function edit(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  stale(ctx, p, input.baseRev);
  const ops = Array.isArray(input.ops) ? (input.ops as In[]) : [];
  if (ops.length === 0 || ops.length > 50) raise(ctx, "validation.bad_input", "Send between 1 and 50 changes.");
  const before = docOf(ctx.db, p.projectId)?.blocks ?? defaultBlocks();
  const r = await applyOps(ctx, p, before, ops);
  const rev = await commit(ctx, p, before, r);
  await say(ctx, p, r.summary);
  return { rev, summary: r.summary, blocks: r.blocks.map(view) };
}

/** Undo the latest change: the page, and any property it set, go back as they were. The undo is a revision of its own, so it can be undone too. */
export async function undo(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const cur = docOf(ctx.db, p.projectId);
  const last = revsOf(ctx.db, p.projectId, 1)[0];
  if (!cur || !last) raise(ctx, "validation.precondition_failed", "There is nothing to undo.", { reason: "nothing_to_undo" });
  if (typeof input.rev === "number" && input.rev !== last.rev) raise(ctx, "validation.precondition_failed", "Only the latest change can be undone.", { reason: "not_latest", rev: last.rev });
  const reverted: Record<string, unknown> = {};
  if (last.props) {
    const now = await readRecord(ctx, p).catch(() => ({} as Record<string, unknown>));
    for (const [k, v] of Object.entries(last.props)) { reverted[k] = now[k] ?? null; await writeRecord(ctx, p, { [k]: v }); }
  }
  const rev = await commit(ctx, p, cur.blocks, { blocks: last.before, summary: `undid: ${last.summary}`, props: reverted }, last.rev);
  return { rev, undid: last.rev, blocks: last.before.map(view) };
}

/** Bring an older version back: its blocks are the page again, as a new revision, so the restore can be undone like any change. */
export async function restore(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  stale(ctx, p, input.baseRev);
  const rev = Number(input.rev);
  const blocks = revBlocks(ctx.db, p.projectId, rev);
  if (!blocks) raise(ctx, "validation.not_found", "That version is no longer kept.", { rev });
  const before = docOf(ctx.db, p.projectId)?.blocks ?? defaultBlocks();
  const at = ctx.now();
  const next = blocks!.map((b) => withAuthor({ ...b }, me(ctx), at));
  const now = await commit(ctx, p, before, { blocks: next, summary: `restored version ${rev}`, props: {} });
  await say(ctx, p, `restored version ${rev}`);
  return { rev: now, restored: rev, blocks: next.map(view) };
}

// ---- templates ----

export async function templatesList(ctx: ProjectsCtx, _input: In): Promise<unknown> {
  ensure(ctx.db);
  seedTemplates(ctx);
  return { templates: templatesOf(ctx.db).map((t) => clean({ templateId: t.templateId, title: t.title, summary: t.summary, builtin: t.builtin, blocks: t.blocks.length, by: t.by, at: t.at })) };
}

export async function templateSave(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  seedTemplates(ctx);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) raise(ctx, "validation.bad_input", "Name the template.");
  let blocks: PageBlock[];
  if (typeof input.projectId === "string") {
    const p = visible(ctx, input.projectId, "view");
    blocks = docOf(ctx.db, p.projectId)?.blocks ?? defaultBlocks();
  } else if (Array.isArray(input.blocks)) {
    blocks = (input.blocks as In[]).map((b) => ({ id: newId("blk", ctx.now()), ...checkBlock(ctx, b) }));
  } else raise(ctx, "validation.bad_input", "Say which project's page to keep, or send the blocks.");
  if (blocks.length === 0 || blocks.length > 300) raise(ctx, "validation.bad_input", "A template holds between 1 and 300 blocks.");
  const clone = blocks.map((b) => clean({ id: b.id, kind: b.kind, text: b.text, level: b.level, live: b.live })) as PageBlock[];
  const existing = typeof input.templateId === "string" ? templateBy(ctx.db, input.templateId) : undefined;
  if (existing?.builtin) raise(ctx, "validation.bad_input", "The built-in templates stay as they are. Save yours under a new name.");
  const templateId = existing?.templateId ?? newId("tpl", ctx.now());
  saveTemplate(ctx.db, { templateId, title, summary: typeof input.summary === "string" ? input.summary : undefined, blocks: clone, builtin: false, by: me(ctx), at: ctx.now() });
  emitP(ctx, "project.overview_template_saved", typeof input.projectId === "string" ? input.projectId : "template", { templateId, title, by: me(ctx) });
  return { template: clean({ templateId, title, summary: typeof input.summary === "string" ? input.summary : undefined, builtin: false, blocks: clone.length, by: me(ctx), at: ctx.now() }) };
}

export async function templateApply(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  seedTemplates(ctx);
  const p = visible(ctx, input.projectId, "edit");
  const tpl = templateBy(ctx.db, String(input.templateId));
  if (!tpl) raise(ctx, "validation.not_found", "That template does not exist.");
  stale(ctx, p, input.baseRev);
  const before = docOf(ctx.db, p.projectId)?.blocks ?? defaultBlocks();
  const blocks = fresh(ctx, tpl.blocks);
  const rev = await commit(ctx, p, before, { blocks, summary: `applied the ${tpl.title} template`, props: {} });
  await say(ctx, p, `applied the ${tpl.title} template`);
  return { rev, blocks: blocks.map(view) };
}

// ---- the page as Markdown for the editor ----
// The shared Markdown editor opens and saves the page as Markdown: every block is led by `<!--b:id-->` so it keeps its identity (author, history) across saves, a heading is `#`, `##` or `###`, and a
// live block is `:::live {json}` on one line with the block's type, spec and view. Text typed in the editor without a marker is a new block per paragraph.

const MARK = /^<!--b:([A-Za-z0-9_]+)-->$/;
export function toMarkdown(blocks: readonly PageBlock[]): string {
  return blocks.map((b) => {
    const body = b.kind === "heading" ? `${"#".repeat(b.level ?? 2)} ${b.text ?? ""}` : b.kind === "text" ? b.text ?? "" : `:::live ${JSON.stringify({ type: b.live!.type, spec: b.live!.spec, ...(b.live!.view ? { view: b.live!.view } : {}) })}`;
    return `<!--b:${b.id}-->\n${body}`;
  }).join("\n\n");
}

/**
 * The blocks of a Markdown page: a marker names the block that follows; every other paragraph is a new block. A blank line between paragraphs splits blocks, except inside fenced code and between the
 * items of a list (a list with blank lines between its items is one block). A heading and a live directive are blocks of their own.
 */
const ITEM = /^\s*([-*+]|\d+[.)])\s/;
export function fromMarkdown(ctx: ProjectsCtx, md: string): Array<Omit<PageBlock, "by" | "at"> & { fresh: boolean }> {
  const chunks: Array<{ id?: string; lines: string[] }> = [];
  let cur: { id?: string; lines: string[] } | null = null;
  let fenced = false;
  const flush = (): void => { if (cur && cur.lines.some((l) => l.trim() !== "")) chunks.push(cur); cur = null; };
  const lines = md.replaceAll("\r\n", "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const mark = !fenced ? MARK.exec(line.trim()) : null;
    if (mark) { flush(); cur = { id: mark[1]!, lines: [] }; continue; }
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "") {
      if (!cur) continue;
      const last = [...cur.lines].reverse().find((l) => l.trim() !== "") ?? "";
      const next = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
      // a blank line inside a list: the paragraph before is a list item and the next line is another item or its continuation
      if (ITEM.test(last) && (ITEM.test(next) || /^\s{2,}\S/.test(next)) && !MARK.test(next.trim())) cur.lines.push(line); else flush();
      continue;
    }
    if (!cur) cur = { lines: [] };
    cur.lines.push(line);
  }
  flush();
  return chunks.map((c) => {
    const body = c.lines.join("\n").replace(/\s+$/, "");
    const id = c.id ?? newId("blk", ctx.now());
    const live = /^:::live\s+(\{.*\})\s*$/s.exec(body);
    if (live) {
      let parsed: In;
      try { parsed = JSON.parse(live[1]!) as In; } catch { raise(ctx, "validation.bad_input", "A live block's settings are not readable."); }
      return { id, fresh: c.id === undefined, kind: "live" as const, live: checkLive(ctx, parsed) };
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(body);
    if (h && !body.includes("\n")) return { id, fresh: c.id === undefined, kind: "heading" as const, text: h[2]!, level: h[1]!.length };
    return { id, fresh: c.id === undefined, kind: "text" as const, text: body };
  });
}

// ---- agents read the page as Markdown ----

/** The page as Markdown for an agent, every block led by its id: `[blk_ab12] ## Heading`, and a live block as a fenced line with its spec. */
export function markdownOf(blocks: readonly PageBlock[]): string {
  return blocks.map((b) => {
    if (b.kind === "heading") return `[${b.id}] ${"#".repeat(b.level ?? 2)} ${b.text ?? ""}`;
    if (b.kind === "text") return `[${b.id}] ${b.text ?? ""}`;
    return `[${b.id}] :::live ${b.live!.type} ${JSON.stringify(b.live!.spec)}${b.live!.view ? ` view=${b.live!.view}` : ""}`;
  }).join("\n\n");
}

export async function overviewGet(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const d = docOf(ctx.db, p.projectId);
  const blocks = d?.blocks ?? defaultBlocks();
  const props = await properties(ctx, p);
  return { rev: d?.rev ?? 0, markdown: markdownOf(blocks), properties: props, liveTypes: [...LIVE_TYPES] };
}

// ---- live blocks ----

export interface LiveRow { id: string; title: string; state?: string | undefined; detail?: string | undefined; url?: string | undefined; who?: string | undefined; due?: number | undefined }
const day = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString().slice(0, 10));
const cap = (spec: Record<string, unknown>, dflt = 20): number => Math.min(100, Math.max(1, Number(spec["limit"] ?? dflt)));
const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Evaluate a live block for the reader: the rows they may open, how many they may not, and for a metric its value. The block stores only its spec. */
export async function evaluate(ctx: ProjectsCtx, p: Project, type: LiveType, spec: Record<string, unknown>): Promise<{ rows: LiveRow[]; hidden: number; total: number; value?: number; label?: string; unit?: string }> {
  const now = ctx.now();
  const done = (rows: LiveRow[], hidden = 0, extra: { value?: number; label?: string; unit?: string } = {}) => ({ rows: rows.slice(0, cap(spec)).map((r) => clean(r)), hidden, total: rows.length + hidden, ...extra });
  switch (type) {
    case "tasks": case "milestones": {
      const tasks = await loadTasks(ctx, p);
      const plans = plansOf(ctx.db, p.projectId);
      let all = tasks.map((t) => planTask(t, plans.get(t.taskId)));
      all = all.filter((t) => (type === "milestones" ? t.milestone && t.status !== "done" && t.status !== "canceled" && (t.due ?? Infinity) >= now : true));
      const st = spec["status"];
      if (type === "tasks") {
        if (st === "late") all = all.filter((t) => isOpenState(t.status) && t.due !== undefined && t.due < now);
        else if (st === "open" || st === undefined) all = all.filter((t) => isOpenState(t.status));
        else if (st === "done") all = all.filter((t) => t.status === "done");
        else if (st === "waiting") all = all.filter((t) => t.status === "in_review" || t.status === "awaiting_approval");
      }
      if (typeof spec["assigned"] === "string" && spec["assigned"] !== "") { const want = spec["assigned"] === "me" ? me(ctx) : spec["assigned"]; all = all.filter((t) => t.assigned === want); }
      all.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
      // Tasks can be private or restricted. `tasks.list` answers the ones the reader may open; the task records of this project counted without regard to access say how many exist, and the difference
      // is what is hidden from them. (A count that cannot be read leaves hidden at 0 rather than guessing.)
      const everyTask = await tolerant<{ count?: number }>(ctx, "records.counts", { type: "task", filter: { field: "project", op: "eq", value: p.recordId } }, {});
      const hiddenTasks = everyTask.count === undefined ? 0 : Math.max(0, everyTask.count - tasks.length);
      return done(all.map((t) => ({ id: t.taskId, title: t.title, state: t.status, detail: [day(t.due), t.due !== undefined && t.due < now && isOpenState(t.status) ? "late" : undefined].filter(Boolean).join(" · ") || undefined, url: `/tasks/${t.taskId}`, ...(t.assigned ? { who: t.assigned } : {}), ...(t.due !== undefined ? { due: t.due } : {}) })), hiddenTasks);
    }
    case "links": case "ci": {
      const kind = type === "ci" ? "ci.run" : typeof spec["kind"] === "string" ? spec["kind"] : undefined;
      const rows: LiveRow[] = [];
      let hidden = 0;
      for (const a of attachesOf(ctx.db, p.projectId, kind)) {
        const l = await liveOf(ctx, a);
        // a link whose source answers nothing and that was made with nothing to show is one the reader may not open
        if (l.label === undefined && l.state === undefined && l.url === undefined) { hidden += 1; continue; }
        rows.push(clean({ id: a.linkId, title: l.label ?? a.ref, state: l.state, detail: a.kind, url: l.url }) as LiveRow);
      }
      return done(rows, hidden);
    }
    case "records": case "metric": {
      const recType = String(spec["type"]);
      const filter = spec["filter"] && typeof spec["filter"] === "object" ? spec["filter"] : undefined;
      const q = await tolerant<{ rows?: Array<{ id: string; fields: Record<string, unknown> }>; total?: number }>(ctx, "records.query", { type: recType, ...(filter ? { filter } : {}), limit: 500 }, {});
      const seen = q.rows ?? [];
      // the type's whole count, whoever may open the rows, so the reader is told how many they may not
      const all = await tolerant<{ count?: number }>(ctx, "records.counts", { type: recType, ...(filter ? { filter } : {}) }, {});
      const visibleN = q.total ?? seen.length;
      const hidden = Math.max(0, (all.count ?? visibleN) - visibleN);
      if (type === "metric") {
        const field = String(spec["field"] ?? "");
        // a money field holds { amount, currency }; a number field holds the number
        const amountOf = (v: unknown): number => (typeof v === "number" ? v : v !== null && typeof v === "object" && typeof (v as { amount?: unknown }).amount === "number" ? (v as { amount: number }).amount : Number(v) || 0);
        const unit = seen.map((r) => r.fields[field]).map((v) => (v !== null && typeof v === "object" ? (v as { currency?: unknown }).currency : undefined)).find((c): c is string => typeof c === "string");
        const value = spec["op"] === "sum" ? seen.reduce((s, r) => s + amountOf(r.fields[field]), 0) : visibleN;
        return { rows: [], hidden, total: visibleN + hidden, value, label: asText(spec["title"]) || (spec["op"] === "sum" ? `Sum of ${field}` : "Count"), ...(spec["op"] === "sum" && unit ? { unit } : {}) };
      }
      const titleOf = (f: Record<string, unknown>, id: string): string => asText(f["title"] ?? f["name"] ?? f["number"] ?? id);
      return done(seen.map((r) => ({ id: r.id, title: titleOf(r.fields, r.id), state: asText(r.fields["status"] ?? r.fields["stage"]) || undefined, detail: spec["show"] && typeof spec["show"] === "string" ? asText(r.fields[spec["show"]]) || undefined : undefined, url: `/records/${recType}/${r.id}` })), hidden);
    }
    case "goal": {
      const f = await readRecord(ctx, p).catch(() => ({} as Record<string, unknown>));
      const g = asText(f["goal"]);
      const goals = await tolerant<{ goals?: Array<{ id: string; title: string; status: string }> }>(ctx, "goals.list", { scope: "project", projectId: p.projectId }, {});
      // A goal can be private to its owner: goals.list answers the ones the reader may open, goals.count (a manager or the system only) says how many exist. Where the reader may not ask, hidden stays 0.
      const every = await tolerant<{ count?: number }>(ctx, "goals.count", { projectId: p.projectId }, {});
      const hiddenGoals = every.count === undefined ? 0 : Math.max(0, every.count - (goals.goals ?? []).length);
      return done([...(g ? [{ id: "goal", title: g }] : []), ...(goals.goals ?? []).map((x) => ({ id: x.id, title: x.title, state: x.status, url: `/goals/${x.id}` }))], hiddenGoals);
    }
    // People and agents: every reader of the project reads its member list whole (a project role is a grant on the project), so nothing is hidden from a reader who can open the Overview.
    case "people": return done(membersOf(ctx.db, p.projectId).map((m) => ({ id: m.principal, title: m.principal, state: m.role, detail: m.kind })));
    // Status: derived from counts the reader's own read of the record and tasks gives; it names no row, so nothing is hidden.
    case "status": {
      const [fields, tasks] = await Promise.all([readRecord(ctx, p).catch(() => ({} as Record<string, unknown>)), loadTasks(ctx, p).catch(() => [])]);
      const row = projectRow(ctx, p, fields, tasks);
      return done([{ id: "status", title: row.status, state: row.health ?? undefined, detail: `${row.openTasks} open, ${row.lateTasks} late` }]);
    }
  }
}

export async function liveQuery(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  let type: LiveType;
  let spec: Record<string, unknown>;
  if (typeof input.blockId === "string") {
    const b = (docOf(ctx.db, p.projectId)?.blocks ?? defaultBlocks()).find((x) => x.id === input.blockId);
    if (!b || b.kind !== "live") raise(ctx, "validation.not_found", "That live block is not on the page.", { blockId: input.blockId });
    type = b.live!.type; spec = b.live!.spec;
  } else {
    const l = checkLive(ctx, { type: input.type, spec: input.spec });
    type = l.type; spec = l.spec;
  }
  const out = await evaluate(ctx, p, type, spec);
  return clean({ type, ...out });
}
