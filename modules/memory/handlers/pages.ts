// Living pages (owner design 30 Oct 2026, ruling 4), the capabilities: read a page (its facts, its Notes, the [[links]] it makes and the places that link to it), write its Notes as a new version, list pages,
// see and restore versions, delete a page to Trash (memory.restore brings it back), read the backlinks from chats, runs, records and other pages, and export the whole brain a reader can see as Markdown.
// A personal page is sealed to its owner: nobody else sees it, in a read, a list, a backlink or the export.
import { createPage, findPage, loadPage, movePage, pageRowOut, readPage, saveNotes, subjectKey, trashPage, updateMeta } from "../pages.ts";
import type { Page, PageKind } from "../pages.ts";
import { factRows } from "../enrich.ts";
import { trail } from "../trail.ts";
import { actorOf, ensure, factOut, makeAccess, num, openText, orNull, pageOf, raise, readFact, rowsOf, str } from "../projections.ts";
import type { Access, Fact, Layer, MemCtx } from "../projections.ts";

type Pg = { cursor?: string; limit?: number };

const pageOut = pageRowOut;

async function mayView(ctx: MemCtx, access: Access, p: Page): Promise<boolean> {
  return p.layer === "person" ? p.ownerRef === actorOf(ctx) : access.can(p.layer, p.ownerRef, p.agentId, p.projectId, "view");
}
async function mayEdit(ctx: MemCtx, access: Access, p: Page): Promise<boolean> {
  return p.layer === "person" ? p.ownerRef === actorOf(ctx) : access.can(p.layer, p.ownerRef, p.agentId, p.projectId, "edit");
}

function needPage(ctx: MemCtx, id: string): Page {
  const p = loadPage(ctx, id);
  if (!p) raise(ctx, "validation.not_found", "There is no such page.", { pageId: id });
  return p;
}
async function needView(ctx: MemCtx, id: string): Promise<{ page: Page; access: Access }> {
  const access = makeAccess(ctx);
  const page = needPage(ctx, id);
  if (!(await mayView(ctx, access, page))) raise(ctx, "validation.not_found", "There is no such page.", { pageId: id });
  return { page, access };
}

const ownerFor = (ctx: MemCtx, layer: Layer, agentId: string | null, projectId: string | null): string =>
  layer === "person" ? actorOf(ctx) : layer === "agent" ? agentId ?? "" : layer === "project" ? projectId ?? "" : ctx.space;

// ---- write

export async function pagePut(
  ctx: MemCtx,
  input: { pageId?: string; title?: string; kind?: PageKind; layer?: Layer; agentId?: string; projectId?: string; subjectRef?: string; subtitle?: string; blurb?: string; notes: string; baseVersion?: number; reason?: string },
) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  let page: Page | null = null;
  let created = false;
  if (input.pageId) {
    page = needPage(ctx, input.pageId);
    if (!(await mayView(ctx, access, page))) raise(ctx, "validation.not_found", "There is no such page.", { pageId: input.pageId });
  } else {
    const title = (input.title ?? "").trim();
    if (title === "") raise(ctx, "validation.bad_input", "A page needs a title.");
    const layer: Layer = input.layer ?? (input.projectId ? "project" : input.agentId ? "agent" : "space");
    if (layer === "agent" && !input.agentId) raise(ctx, "validation.bad_input", "Name the agent this page belongs to.");
    if (layer === "project" && !input.projectId) raise(ctx, "validation.bad_input", "Name the project this page belongs to.");
    const agentId = layer === "agent" ? input.agentId ?? null : null;
    const projectId = layer === "project" ? input.projectId ?? null : null;
    const owner = ownerFor(ctx, layer, agentId, projectId);
    page = findPage(ctx, layer, owner, subjectKey(title));
    if (!page) {
      if (!(await mayEdit(ctx, access, { layer, ownerRef: owner, agentId, projectId } as Page))) raise(ctx, "permission.no_grant", "You cannot add to this memory.");
      // the first Notes are version 1 of the page
      page = createPage(ctx, { title, kind: input.kind ?? "topic", layer, ownerRef: owner, agentId, projectId, subjectRef: input.subjectRef ?? null, notes: input.notes, subtitle: input.subtitle ?? null, blurb: input.blurb ?? null }, { ...(input.reason ? { reason: input.reason } : {}) });
      created = true;
    }
  }
  if (!(await mayEdit(ctx, access, page))) raise(ctx, "permission.no_grant", "You cannot change this page.");
  if (page.trashedAt !== null) raise(ctx, "validation.precondition_failed", "This page is in Trash. Restore it first.", { pageId: page.id });
  if (!created && input.baseVersion !== undefined && input.baseVersion !== page.version) {
    raise(ctx, "validation.precondition_failed", "Someone changed this page since you opened it.", { pageId: page.id, version: page.version });
  }
  let saved = created ? page : saveNotes(ctx, page, input.notes, { ...(input.reason ? { reason: input.reason } : {}) });
  if (!created && (input.subtitle !== undefined || input.blurb !== undefined)) saved = updateMeta(ctx, saved, { ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}), ...(input.blurb !== undefined ? { blurb: input.blurb } : {}) });
  const links = num(rowsOf(ctx.db, "SELECT COUNT(*) AS n FROM memory_page_links WHERE from_page = ?", saved.id)[0]?.["n"]);
  return { page: pageOut(saved), created, links };
}

// ---- read

interface LinkRow { label: string; title: string; pageId?: string; evidence: string }
interface Backlink { kind: "page" | "chat" | "run" | "record"; ref: string; title: string; quote: string; link?: string; at: number; label?: string }

/** The links a page makes, with the page each one points at when it exists. */
function linksOf(ctx: MemCtx, p: Page): LinkRow[] {
  const out: LinkRow[] = [];
  for (const r of rowsOf(ctx.db, "SELECT * FROM memory_page_links WHERE from_page = ? ORDER BY rowid", p.id)) {
    let label = str(r["label"]);
    let evidence = str(r["evidence"]);
    let title = str(r["target"]);
    const sealed = orNull(r["sealed"]);
    if (p.layer === "person") {
      if (p.ownerRef !== actorOf(ctx) || !sealed) continue;
      try { const o = JSON.parse(openText(ctx, sealed)) as { label?: string; evidence?: string; target?: string }; label = o.label ?? ""; evidence = o.evidence ?? ""; title = o.target ?? ""; } catch { continue; }
    }
    const to = str(r["to_page"]);
    const dest = to.startsWith("~") ? null : loadPage(ctx, to);
    out.push({ label, title: dest?.title ?? title, ...(dest && dest.trashedAt === null ? { pageId: dest.id } : {}), evidence });
  }
  return out;
}

/** Where this page is linked from: other pages, and chats, runs and records, each shown only to a reader who can open the place. */
async function backlinksOf(ctx: MemCtx, access: Access, p: Page): Promise<Backlink[]> {
  const out: Backlink[] = [];
  for (const r of rowsOf(ctx.db, "SELECT l.*, pg.title AS from_title FROM memory_page_links l JOIN memory_pages pg ON pg.page_id = l.from_page WHERE l.to_page = ? AND pg.trashed_at IS NULL ORDER BY l.at DESC, l.rowid DESC", p.id)) {
    const from = loadPage(ctx, str(r["from_page"]));
    if (!from || !(await mayView(ctx, access, from))) continue;
    if (from.layer === "person") continue;
    out.push({ kind: "page", ref: from.id, title: from.title, quote: str(r["evidence"]), link: `/memory/pages/${from.id}`, at: num(r["at"]), ...(str(r["label"]) ? { label: str(r["label"]) } : {}) });
  }
  const memo = new Map<string, boolean>();
  for (const r of rowsOf(ctx.db, "SELECT * FROM memory_mentions WHERE page_id = ? ORDER BY at DESC, rowid DESC", p.id)) {
    const key = `${str(r["res_type"])}:${str(r["res_id"])}`;
    let ok = memo.get(key);
    if (ok === undefined) { ok = ctx.authorize({ perm: null, level: "view" }, { type: str(r["res_type"]), id: str(r["res_id"]) }).effect === "allow"; memo.set(key, ok); }
    if (!ok) continue;
    const kind = str(r["source_kind"]) as Backlink["kind"];
    const ref = str(r["source_ref"]);
    const node = rowsOf(ctx.db, "SELECT title, link FROM memory_graph_nodes WHERE node_id = ?", `${kind === "run" ? "chat" : kind}:${ref}`)[0];
    out.push({ kind, ref, title: node ? str(node["title"]) : kind === "record" ? "Record" : kind === "run" ? "Run" : "Chat", quote: str(r["quote"]), ...(node && node["link"] ? { link: str(node["link"]) } : {}), at: num(r["at"]) });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Current facts the reader can see that are about this page's subject: they name it, or came from the record it stands for. */
function factsAbout(ctx: MemCtx, access: Access, p: Page): Promise<Fact[]> {
  const me = actorOf(ctx);
  const needle = subjectKey(p.title);
  const rows = rowsOf(
    ctx.db,
    "SELECT * FROM memory_facts WHERE status = 'current' AND trashed_at IS NULL AND (layer != 'person' OR owner_ref = ?) AND ((enc = 0 AND LOWER(text) LIKE ?) OR (enc = 2 AND owner_ref = ?) OR (subject IS NOT NULL AND subject = ?)) ORDER BY learned_at DESC, id LIMIT 300",
    me, `%${needle.replace(/[%_]/g, "")}%`, me, p.subjectRef ?? "",
  );
  return (async () => {
    const out: Fact[] = [];
    const memo = new Map<string, boolean>();
    for (const r of rows) {
      const f = readFact(ctx, r);
      if (f.text === "") continue;
      const named = f.text.toLowerCase().includes(needle) || (p.subjectRef !== null && f.sourceRef === p.subjectRef);
      if (!named) continue;
      const key = `${f.layer}|${f.ownerRef}|${f.agentId ?? ""}|${f.projectId ?? ""}`;
      let ok = memo.get(key);
      if (ok === undefined) { ok = f.layer === "person" ? f.ownerRef === me : await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view"); memo.set(key, ok); }
      if (ok) out.push(f);
      if (out.length >= 100) break;
    }
    return out;
  })();
}

export async function pageGet(ctx: MemCtx, input: { pageId?: string; title?: string; layer?: Layer; agentId?: string; projectId?: string }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  let page: Page | null = null;
  if (input.pageId) page = (await needView(ctx, input.pageId)).page;
  else {
    const title = (input.title ?? "").trim();
    if (title === "") raise(ctx, "validation.bad_input", "Name the page by id or title.");
    const key = subjectKey(title);
    // shared pages are found by their title column; the reader's own personal pages are opened and compared, since their titles are sealed
    const rows = [
      ...rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE subject = ? AND layer != 'person' ORDER BY CASE layer WHEN 'space' THEN 0 WHEN 'project' THEN 1 ELSE 2 END, created_at", key),
      ...rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE layer = 'person' AND owner_ref = ? ORDER BY created_at", actorOf(ctx)).filter((r) => readPage(ctx, r).subject === key),
    ];
    for (const r of rows) {
      const p = readPage(ctx, r);
      if (input.layer && p.layer !== input.layer) continue;
      if (input.agentId && p.agentId !== input.agentId) continue;
      if (input.projectId && p.projectId !== input.projectId) continue;
      if (await mayView(ctx, access, p)) { page = p; break; }
    }
    if (!page) raise(ctx, "validation.not_found", "There is no such page.", { title });
  }
  if (page.trashedAt !== null && page.archivedAt === null) ctx.db.run("UPDATE memory_pages SET touched_at = ? WHERE page_id = ?", ctx.now(), page.id);
  const [facts, backlinks] = await Promise.all([factsAbout(ctx, access, page), backlinksOf(ctx, access, page)]);
  const versions = num(rowsOf(ctx.db, "SELECT COUNT(*) AS n FROM memory_page_versions WHERE page_id = ?", page.id)[0]?.["n"]);
  return { page: pageOut(page), notes: page.notes, facts: factRows(ctx, facts), links: linksOf(ctx, page), backlinks, versions };
}

export async function pageList(ctx: MemCtx, input: Pg & { q?: string; layer?: Layer; kind?: PageKind; agentId?: string; projectId?: string }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const args: unknown[] = [actorOf(ctx)];
  let sql = "SELECT * FROM memory_pages WHERE trashed_at IS NULL AND (layer != 'person' OR owner_ref = ?)";
  if (input.layer) { sql += " AND layer = ?"; args.push(input.layer); }
  if (input.kind) { sql += " AND kind = ?"; args.push(input.kind); }
  if (input.agentId) { sql += " AND agent_id = ?"; args.push(input.agentId); }
  if (input.projectId) { sql += " AND project_id = ?"; args.push(input.projectId); }
  const q = (input.q ?? "").trim().toLowerCase();
  // a personal page's title and Notes are sealed, so the words are checked after it is opened for its owner
  if (q !== "") { sql += " AND (layer = 'person' OR subject LIKE ? OR LOWER(notes) LIKE ?)"; args.push(`%${q.replace(/[%_]/g, "")}%`, `%${q.replace(/[%_]/g, "")}%`); }
  sql += " ORDER BY updated_at DESC, page_id";
  const pages: Page[] = [];
  for (const r of rowsOf(ctx.db, sql, ...args)) {
    const p = readPage(ctx, r);
    if (q !== "" && p.layer === "person" && !p.subject.includes(q) && !p.notes.toLowerCase().includes(q)) continue;
    if (await mayView(ctx, access, p)) pages.push(p);
  }
  const p = pageOf(pages, input.cursor, input.limit);
  return { pages: p.page.map(pageOut), ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function pageVersions(ctx: MemCtx, input: { pageId: string }) {
  ensure(ctx.db);
  const { page } = await needView(ctx, input.pageId);
  const versions = rowsOf(ctx.db, "SELECT * FROM memory_page_versions WHERE page_id = ? ORDER BY version DESC", page.id).map((r) => {
    let notes = str(r["notes"]);
    const sealed = orNull(r["sealed"]);
    if (num(r["enc"]) === 2 && sealed) { try { notes = page.ownerRef === actorOf(ctx) ? openText(ctx, sealed) : ""; } catch { notes = ""; } }
    return { version: num(r["version"]), by: str(r["by_actor"]), actorKind: str(r["actor_kind"]), at: num(r["at"]), ...(r["reason"] ? { reason: str(r["reason"]) } : {}), notes };
  });
  return { versions };
}

export async function pageRestoreVersion(ctx: MemCtx, input: { pageId: string; version: number }) {
  ensure(ctx.db);
  const { page, access } = await needView(ctx, input.pageId);
  if (!(await mayEdit(ctx, access, page))) raise(ctx, "permission.no_grant", "You cannot change this page.");
  if (page.trashedAt !== null) raise(ctx, "validation.precondition_failed", "This page is in Trash. Restore it first.");
  const old = (await pageVersions(ctx, { pageId: page.id })).versions.find((v) => v.version === input.version);
  if (!old) raise(ctx, "validation.not_found", "There is no such version.", { version: input.version });
  const saved = saveNotes(ctx, page, old.notes, { reason: `restored version ${input.version}` });
  return { page: pageOut(saved) };
}

export async function pageDelete(ctx: MemCtx, input: { pageId: string }) {
  ensure(ctx.db);
  const { page, access } = await needView(ctx, input.pageId);
  if (!(await mayEdit(ctx, access, page))) raise(ctx, "permission.no_grant", "You cannot change this page.");
  const moved = trashPage(ctx, page, "removed");
  if (moved) ctx.emit("memory.removed", actorOf(ctx), { factIds: [], by: actorOf(ctx) });
  return { page: pageOut({ ...page, trashedAt: moved ? ctx.now() : page.trashedAt }), trashed: moved };
}

/** Change who can see a page: move it to the Space, a project, an agent or the caller's own personal layer. Its Notes, versions and links go with it. */
export async function pageSetVisibility(ctx: MemCtx, input: { pageId: string; layer: Layer; agentId?: string; projectId?: string }) {
  ensure(ctx.db);
  const { page, access } = await needView(ctx, input.pageId);
  if (!(await mayEdit(ctx, access, page))) raise(ctx, "permission.no_grant", "You cannot change this page.");
  if (page.trashedAt !== null) raise(ctx, "validation.precondition_failed", "This page is in Trash. Restore it first.");
  if (input.layer === "agent" && !input.agentId) raise(ctx, "validation.bad_input", "Name the agent this page belongs to.");
  if (input.layer === "project" && !input.projectId) raise(ctx, "validation.bad_input", "Name the project this page belongs to.");
  const agentId = input.layer === "agent" ? input.agentId ?? null : null;
  const projectId = input.layer === "project" ? input.projectId ?? null : null;
  const owner = ownerFor(ctx, input.layer, agentId, projectId);
  if (page.layer === input.layer && page.ownerRef === owner) return { page: pageOut(page), moved: false };
  if (!(await mayEdit(ctx, access, { layer: input.layer, ownerRef: owner, agentId, projectId } as Page))) raise(ctx, "permission.no_grant", "You cannot add to that memory.");
  if (findPage(ctx, input.layer, owner, subjectKey(page.title))) raise(ctx, "validation.precondition_failed", "A page with this title is already there.", { title: page.title });
  const moved = movePage(ctx, page, { layer: input.layer, ownerRef: owner, agentId, projectId });
  return { page: pageOut(moved), moved: true };
}

export async function backlinks(ctx: MemCtx, input: Pg & { pageId: string }) {
  ensure(ctx.db);
  const { page, access } = await needView(ctx, input.pageId);
  const all = await backlinksOf(ctx, access, page);
  const p = pageOf(all, input.cursor, input.limit);
  return { backlinks: p.page, ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---- erase

/** Remove a page for good, its versions, links and mentions with it, leaving one contentless line on the trail. Callers check who may. */
export function erasePage(ctx: MemCtx, p: Page, reason?: string): void {
  trail(ctx, { action: "erase", pageId: p.id, layer: p.layer, ownerRef: p.ownerRef, agentId: p.agentId, projectId: p.projectId, ...(reason ? { reason } : {}) });
  ctx.db.run("DELETE FROM memory_page_versions WHERE page_id = ?", p.id);
  ctx.db.run("DELETE FROM memory_page_links WHERE from_page = ? OR to_page = ?", p.id, p.id);
  ctx.db.run("DELETE FROM memory_mentions WHERE page_id = ?", p.id);
  ctx.db.run("DELETE FROM memory_vectors WHERE doc_kind = 'page' AND doc_id = ?", p.id);
  ctx.db.run("DELETE FROM memory_graph_nodes WHERE node_id = ?", `page:${p.id}`);
  ctx.db.run("DELETE FROM memory_pages WHERE page_id = ?", p.id);
}

// ---- export

/** The whole brain the reader can see, as Markdown: pages with their facts and Notes, then the facts no page names. The reader's own personal layer is included only when they ask. */
export async function exportMarkdown(ctx: MemCtx, input: { includePersonal?: boolean }) {
  ensure(ctx.db);
  const access = makeAccess(ctx);
  const me = actorOf(ctx);
  const personal = input.includePersonal === true;
  const day = (t: number): string => new Date(t).toISOString().slice(0, 10);
  const pageRows: Page[] = [];
  for (const r of rowsOf(ctx.db, "SELECT * FROM memory_pages WHERE trashed_at IS NULL AND (layer != 'person' OR owner_ref = ?) ORDER BY CASE layer WHEN 'space' THEN 0 WHEN 'project' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END, subject", me)) {
    const p = readPage(ctx, r);
    if (p.layer === "person" && !personal) continue;
    if (await mayView(ctx, access, p)) pageRows.push(p);
  }
  const factRows: Fact[] = [];
  const memo = new Map<string, boolean>();
  for (const r of rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE status = 'current' AND trashed_at IS NULL AND (layer != 'person' OR owner_ref = ?) ORDER BY learned_at DESC, id", me)) {
    const f = readFact(ctx, r);
    if (f.text === "" || (f.layer === "person" && !personal)) continue;
    const key = `${f.layer}|${f.ownerRef}|${f.agentId ?? ""}|${f.projectId ?? ""}`;
    let ok = memo.get(key);
    if (ok === undefined) { ok = f.layer === "person" ? f.ownerRef === me : await access.can(f.layer, f.ownerRef, f.agentId, f.projectId, "view"); memo.set(key, ok); }
    if (ok) factRows.push(f);
  }
  const used = new Set<string>();
  const factLine = (f: Fact): string => `- ${f.text.replace(/\n+/g, " ")} (since ${day(f.validFrom)}${f.sourceLink ? `, from ${f.sourceLink}` : ""})`;
  const lines: string[] = [`# Memory export`, ``, `Exported ${day(ctx.now())}. This is what the reader can see${personal ? ", including their own personal memory" : ""}.`, ``];
  let lastLayer = "";
  for (const p of pageRows) {
    if (p.layer !== lastLayer) { lines.push(`## ${p.layer === "space" ? "Space" : p.layer === "project" ? "Projects" : p.layer === "agent" ? "Agents" : "Personal"}`, ``); lastLayer = p.layer; }
    lines.push(`### ${p.title}`, ``, `Kind: ${p.kind}. Layer: ${p.layer}. Version ${p.version}, updated ${day(p.updatedAt)}.`, ``);
    const named = factRows.filter((f) => f.layer === p.layer && f.text.toLowerCase().includes(p.subject));
    if (named.length > 0) { lines.push(`Facts`, ``, ...named.map(factLine), ``); named.forEach((f) => used.add(f.id)); }
    if (p.notes.trim() !== "") lines.push(`Notes`, ``, p.notes.trimEnd(), ``);
    const out = linksOf(ctx, p);
    if (out.length > 0) lines.push(`Links`, ``, ...out.map((l) => `- ${l.label ? `${l.label}: ` : ""}[[${l.title}]]${l.evidence ? ` (${l.evidence})` : ""}`), ``);
  }
  const rest = factRows.filter((f) => !used.has(f.id));
  if (rest.length > 0) {
    lines.push(`## Facts no page names`, ``);
    for (const layer of ["space", "project", "agent", "person"] as const) {
      const mine = rest.filter((f) => f.layer === layer);
      if (mine.length > 0) lines.push(`### ${layer === "space" ? "Space" : layer === "project" ? "Projects" : layer === "agent" ? "Agents" : "Personal"}`, ``, ...mine.map(factLine), ``);
    }
  }
  const markdown = `${lines.join("\n").trimEnd()}\n`;
  return { markdown, pages: pageRows.length, facts: factRows.length, bytes: Buffer.byteLength(markdown, "utf8") };
}

