// Redaction for AI (owner 3 Nov, rc.20): Agent access on folders and files, the redaction and highlight layer, review, requests, and the read gate's files half.
// Agent access: Available (on), Redacted (agents read reviewed, redacted versions only) or Not available (off), inherited down the tree, a file or subfolder may set its own. Mounted Drive, OneDrive and
// SharePoint folders are Files folders, so the same rows cover them; nothing is ever written to the provider.
// The host calls `files.agent_gate` (a host call, below) for every call an agent is behind, before and after its handler (host/src/seams/agent-read.ts). It answers the output an agent may have, or a
// refusal: Not available, or Needs review in a Redacted folder (which asks a person: "Redact before I can read"). Text is rendered with lib/redact.ts: [REDACTED] for every redaction, ==...== for
// highlights, never a comment.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { REDACTED, agentName, classify, detect, isAgentAccess, reanchor, redactedTexts, renderForAgent, scrubAll, scrubDeep, type AgentAccess, type Mark } from "../../../lib/redact.ts";
import { bytesToB64, fail, many, one, num, rec, optStr, optInt, treeHandlers } from "./tree.ts";

type Row = Record<string, unknown>;
type O = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;
const isObj = (v: unknown): v is O => typeof v === "object" && v !== null && !Array.isArray(v);
const person = (ctx: Ctx): string => (ctx.principal.kind === "agent" && ctx.actingFor?.startsWith("usr_") ? ctx.actingFor : ctx.principal.id);

// ---- access ----

const fileRow = (ctx: Ctx, id: string): Row | undefined => one(ctx, "SELECT * FROM files_file WHERE id = ?", id);
const folderRow = (ctx: Ctx, id: string): Row | undefined => one(ctx, "SELECT * FROM files_folder WHERE id = ?", id);
const setting = (ctx: Ctx, kind: "file" | "folder", id: string): Row | undefined => one(ctx, "SELECT * FROM files_agent_access WHERE target_kind = ? AND target_id = ?", kind, id);

/** The folder and every folder above it, nearest first. */
export function folderChain(ctx: Ctx, folderId: string): Row[] {
  const out: Row[] = [], seen = new Set<string>();
  let cur: string | null = folderId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = folderRow(ctx, cur);
    if (!f) break;
    out.push(f);
    cur = typeof f.parent_id === "string" && f.parent_id !== "" ? f.parent_id : null;
  }
  return out;
}

export interface AccessOut { value: AgentAccess; own: boolean; from?: { kind: "file" | "folder"; id: string; name: string }; setBy?: string; setAt?: number }

/** What agents may do with a file or a folder: its own setting, else the nearest folder above with one, else Available. */
export function accessOf(ctx: Ctx, t: { fileId?: string; folderId?: string }): AccessOut {
  let start = t.folderId;
  if (t.fileId) {
    const own = setting(ctx, "file", t.fileId);
    const f = fileRow(ctx, t.fileId);
    if (own && isAgentAccess(own.value)) return { value: own.value, own: true, from: { kind: "file", id: t.fileId, name: str(f?.name) }, setBy: str(own.set_by), setAt: num(own.set_at) };
    start = f ? str(f.folder_id) : undefined;
  }
  if (!start) return { value: "on", own: false };
  const chain = folderChain(ctx, start);
  for (const fo of chain) {
    const s = setting(ctx, "folder", str(fo.id));
    if (s && isAgentAccess(s.value)) return { value: s.value, own: !t.fileId && str(fo.id) === t.folderId, from: { kind: "folder", id: str(fo.id), name: str(fo.name) }, setBy: str(s.set_by), setAt: num(s.set_at) };
  }
  return { value: "on", own: false };
}

// ---- the layer ----

const toMark = (r: Row): Mark => ({
  id: str(r.id), kind: str(r.kind) === "highlight" ? "highlight" : "redact", shape: (["span", "box", "range", "name"].includes(str(r.shape)) ? str(r.shape) : "span") as Mark["shape"],
  text: r.text === null || r.text === undefined ? null : str(r.text), occurrence: r.occurrence === null || r.occurrence === undefined ? null : num(r.occurrence),
  page: r.page === null || r.page === undefined ? null : num(r.page), box: typeof r.box === "string" && r.box ? (JSON.parse(r.box) as NonNullable<Mark["box"]>) : null,
  from: r.range_from === null || r.range_from === undefined ? null : num(r.range_from), to: r.range_to === null || r.range_to === undefined ? null : num(r.range_to),
  label: r.label === null || r.label === undefined ? null : str(r.label),
});
const liveRows = (ctx: Ctx, targetId: string): Row[] => many(ctx, "SELECT * FROM files_mark WHERE target_id = ? AND removed_at IS NULL", targetId);

/** The name pieces hidden on a file and every folder above it, for paths and names. */
function nameMarks(ctx: Ctx, fileId: string | null, folderId: string | null): Mark[] {
  const out: Mark[] = [];
  if (fileId) out.push(...liveRows(ctx, fileId).filter((r) => str(r.shape) === "name").map(toMark));
  if (folderId) for (const fo of folderChain(ctx, folderId)) out.push(...liveRows(ctx, str(fo.id)).filter((r) => str(r.shape) === "name").map(toMark));
  return out;
}

async function textOf(ctx: Ctx, fileId: string, versionId?: string): Promise<string | null> {
  try { return str(((await treeHandlers["files.read"](ctx, { fileId, as: "text", ...(versionId ? { versionId } : {}) })) as { text?: string }).text); }
  catch { return null; }
}
const versionIdOf = (ctx: Ctx, fileId: string, n: number): string | undefined => { const v = one(ctx, "SELECT id FROM files_file_version WHERE file_id = ? AND n = ?", fileId, n); return v ? str(v.id) : undefined; };

/**
 * Carry the marks of an older version to the current one (once per new version). Marks whose text is gone are unplaced; any unplaced redaction makes the file Needs review, and a reviewed file whose
 * redactions all carried over stays reviewed on the new version.
 */
async function anchor(ctx: Ctx, file: Row): Promise<void> {
  const fileId = str(file.id), cur = num(file.version);
  const stale = liveRows(ctx, fileId).filter((r) => str(r.shape) !== "name" && num(r.unplaced) === 0 && num(r.version) < cur);
  if (!stale.length) return;
  const newText = (await textOf(ctx, fileId)) ?? "";
  const byVersion = new Map<number, Row[]>();
  for (const r of stale) byVersion.set(num(r.version), [...(byVersion.get(num(r.version)) ?? []), r]);
  let lost = 0;
  for (const [v, rows] of byVersion) {
    const vid = versionIdOf(ctx, fileId, v);
    const oldText = (vid ? await textOf(ctx, fileId, vid) : null) ?? newText;
    const { placed, unplaced } = reanchor(oldText, newText, rows.map(toMark));
    for (const m of placed) ctx.db.run("UPDATE files_mark SET version = ?, occurrence = ? WHERE id = ?", cur, m.occurrence ?? null, m.id);
    for (const m of unplaced) { ctx.db.run("UPDATE files_mark SET unplaced = 1 WHERE id = ?", m.id); if (m.kind === "redact") lost++; }
  }
  const rev = one(ctx, "SELECT * FROM files_review WHERE file_id = ?", fileId);
  if (lost) {
    putReview(ctx, fileId, cur, "needs", rev ? str(rev.by) : null);
    ctx.emit("file.needs_review", `file/${fileId}`, { fileId, version: cur, unplaced: lost });
  } else if (rev && str(rev.state) === "reviewed" && num(rev.version) < cur) putReview(ctx, fileId, cur, "reviewed", str(rev.by));
}
function putReview(ctx: Ctx, fileId: string, version: number, state: "reviewed" | "needs", by: string | null): void {
  ctx.db.run("INSERT INTO files_review (file_id, version, state, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET version = excluded.version, state = excluded.state, by = excluded.by, at = excluded.at", fileId, version, state, by, ctx.now());
}

export type AgentState = "clear" | "redacted" | "needs" | "off";
export interface StateOut { state: AgentState; access: AccessOut; marks: Mark[]; unplaced: number; reviewed: { by: string; at: number; version: number } | null; file: Row }

/** What an agent gets of a file now: clear (as it is), redacted (with marks), needs (review first) or off. */
export async function stateOf(ctx: Ctx, fileId: string): Promise<StateOut | null> {
  let file = fileRow(ctx, fileId);
  if (!file) return null;
  const access = accessOf(ctx, { fileId });
  if (access.value !== "off") { await anchor(ctx, file); file = fileRow(ctx, fileId) ?? file; }
  const rows = liveRows(ctx, fileId), unplaced = rows.filter((r) => num(r.unplaced) === 1 && str(r.kind) === "redact").length;
  const marks = rows.filter((r) => num(r.unplaced) === 0 && str(r.shape) !== "name").map(toMark);
  const rev = one(ctx, "SELECT * FROM files_review WHERE file_id = ?", fileId);
  const reviewed = rev && str(rev.state) === "reviewed" && num(rev.version) >= num(file.version) ? { by: str(rev.by), at: num(rev.at), version: num(rev.version) } : null;
  const base = { access, marks, unplaced, reviewed, file };
  if (access.value === "off") return { state: "off", ...base };
  if (unplaced > 0 || (rev && str(rev.state) === "needs")) return { state: "needs", ...base };
  if (access.value === "redact" && !reviewed) return { state: "needs", ...base };
  return { state: marks.some((m) => m.kind === "redact") || marks.some((m) => m.kind === "highlight") ? "redacted" : "clear", ...base };
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|py|rb|go|rs|java|c|h|cpp|cs|php|sh|sql|toml|yaml|yml|json|css|html)$/i;
const withHighlights = (file: Row): boolean => !CODE_EXT.test(str(file.name)) && str(file.kind) !== "code";

/** The whole text of a file version as an agent reads it, or null when it has none. */
export async function agentText(ctx: Ctx, s: StateOut, versionId?: string): Promise<string | null> {
  const t = await textOf(ctx, str(s.file.id), versionId);
  if (t === null) return null;
  return renderForAgent(t, s.marks, { highlights: withHighlights(s.file) });
}

// ---- who is reading, requests and the read note ----

export interface Who { principal: { kind: string; id: string }; actingFor?: string; thread?: string; run?: string; origin?: string }
const agentOfWho = (w: Who): string | undefined => (w.principal.kind === "agent" || w.principal.kind === "actor" ? w.principal.id : undefined);
const askerOfWho = (w: Who): string | undefined => (w.actingFor?.startsWith("usr_") ? w.actingFor : w.principal.kind === "person" ? w.principal.id : undefined);

/** Ask a person to review a file an agent wants (once per agent and asker while one waits). */
export function askToRedact(ctx: Ctx, file: Row, w: Who): string {
  const fileId = str(file.id), agent = agentOfWho(w) ?? null, asker = askerOfWho(w) ?? null;
  const open = many(ctx, "SELECT * FROM files_redact_request WHERE file_id = ? AND state = ?", fileId, "waiting").find((r) => str(r.agent) === str(agent) && str(r.asker) === str(asker));
  if (open) return str(open.id);
  const id = nid(ctx, "rrq");
  ctx.db.run("INSERT INTO files_redact_request (id, file_id, agent, asker, thread, task_id, state, at, done_by, done_at) VALUES (?, ?, ?, ?, ?, NULL, 'waiting', ?, NULL, NULL)", id, fileId, agent, asker, w.thread ?? null, ctx.now());
  ctx.emit("file.redact_requested", `file/${fileId}`, { requestId: id, fileId, name: str(file.name), ...(agent ? { agentId: agent } : {}), ...(asker ? { actingFor: asker } : {}), ...(w.thread ? { threadId: w.thread } : {}) });
  return id;
}

function noteRead(ctx: Ctx, s: StateOut, w: Who): void {
  if (s.state !== "redacted" && s.access.value === "on") return;
  ctx.emit("file.agent_read", `file/${str(s.file.id)}`, { fileId: str(s.file.id), version: num(s.file.version), redacted: s.state === "redacted", ...(agentOfWho(w) ? { agentId: agentOfWho(w) } : {}), ...(askerOfWho(w) ? { actingFor: askerOfWho(w) } : {}) });
}

// ---- the gate ----

type Gate = { output: unknown } | { refuse: { code: string; message: string; details: O } };
const refuseOff = (name: string, id: string): Gate => ({ refuse: { code: "permission.no_grant", message: `${name || "This file"} is not available to AI. A person can change its Agent access in Files.`, details: { reason: "agent_access_off", fileId: id } } });
const refuseNeeds = (name: string, id: string, requestId: string): Gate => ({ refuse: { code: "permission.needs_approval", message: `${name || "This file"} is in a Redacted folder and nobody has reviewed it yet. A person has been asked to redact it before you read it; you are told when it is ready. Do not guess what it says.`, details: { reason: "needs_review", fileId: id, requestId } } });
const refuseBinary = (name: string, id: string): Gate => ({ refuse: { code: "validation.unsupported", message: `${name || "This file"} has parts hidden from AI. Read it as text: you get it with [REDACTED] where they are.`, details: { reason: "redacted_binary", fileId: id } } });

/** Content capabilities: the output is the file's content and the input names the file. */
const CONTENT = new Set(["files.read", "files.viewer_data", "files.diff", "sheets.info", "sheets.read_rows", "files.lint", "previews.text", "previews.get", "previews.pages", "previews.thumbnails", "files.markup.get", "mounts.sheet_read", "mounts.open", "mounts.history"]);
const PICTURES = new Set(["previews.get", "previews.pages", "previews.thumbnails"]);
/** Writes an agent may not make on a file it cannot read as it is: a copy or a move would carry it out of its Redacted or Not available folder without its layer. */
const CARRY = new Set(["files.copy", "files.move", "files.folder.move", "files.share_external", "mail.send_file"]);

const fileIdIn = (input: unknown): string | undefined => (isObj(input) && typeof input.fileId === "string" ? input.fileId : undefined);

/** Every file below a folder that is not clear for agents, with why (for a folder handed to an engine or a git tree). */
async function unclearBelow(ctx: Ctx, folderId: string): Promise<boolean> {
  const own = accessOf(ctx, { folderId });
  if (own.value !== "on") return true;
  const ids = [folderId], seen = new Set(ids);
  for (let i = 0; i < ids.length && i < 5000; i++) for (const c of many(ctx, "SELECT id FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", ids[i])) { const k = str(c.id); if (!seen.has(k)) { seen.add(k); ids.push(k); } }
  for (const fo of ids) {
    if (fo !== folderId) { const s = setting(ctx, "folder", fo); if (s && str(s.value) !== "on") return true; }
    for (const f of many(ctx, "SELECT id FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", fo)) {
      const s = setting(ctx, "file", str(f.id)); if (s && str(s.value) !== "on") return true;
      if (liveRows(ctx, str(f.id)).some((r) => str(r.kind) === "redact")) return true;
    }
    if (liveRows(ctx, fo).some((r) => str(r.shape) === "name")) return true;
  }
  return false;
}

/** Names and paths an agent reads: hidden pieces become [REDACTED]; files it may not open at all, and what sits inside a Not available folder, are left out of lists. */
type Look = { drop: boolean; blank: boolean; marks: Mark[]; texts: string[] };
async function namesPass(ctx: Ctx, v: unknown, cache: Map<string, Look>): Promise<unknown> {
  const look = async (fileId: string | null, folderId: string | null): Promise<Look> => {
    const k = `${fileId ?? ""}|${folderId ?? ""}`;
    const hit = cache.get(k); if (hit) return hit;
    let drop = false, blank = false, texts: string[] = [], fo = folderId;
    if (fileId) {
      const f = fileRow(ctx, fileId);
      if (f) { fo = fo ?? str(f.folder_id); const s = await stateOf(ctx, fileId); drop = s?.state === "off"; blank = s?.state === "needs"; texts = s && s.state !== "clear" ? redactedTexts(s.marks) : []; }
    } else if (folderId) {
      const parent = str(folderRow(ctx, folderId)?.parent_id);
      drop = parent !== "" && accessOf(ctx, { folderId: parent }).value === "off";
    }
    const out = { drop, blank, marks: nameMarks(ctx, fileId, fo), texts };
    cache.set(k, out); return out;
  };
  const walk = async (x: unknown): Promise<unknown> => {
    if (Array.isArray(x)) { const out: unknown[] = []; for (const y of x) { const w = await walk(y); if (w !== DROP) out.push(w); } return out; }
    if (!isObj(x)) return x;
    const isFileRef = (x.type === "file" || x.kind === "file" || x.entity === "file") && typeof x.id === "string";
    const fileId = typeof x.fileId === "string" ? x.fileId : isFileRef ? (x.id as string) : null;
    const folderId = typeof x.folderId === "string" ? x.folderId : null;
    const o: O = {};
    for (const [k, y] of Object.entries(x)) o[k] = await walk(y);
    if (!fileId && !folderId) return o;
    const l = await look(fileId, folderId);
    if (l.drop && ("name" in x || "title" in x)) return DROP;
    for (const k of ["name", "title", "path", "fullPath"]) if (typeof o[k] === "string") o[k] = agentName(o[k] as string, l.marks);
    for (const k of ["snippet", "excerpt", "preview", "summary", "text", "body", "markdown"]) if (typeof o[k] === "string") o[k] = l.blank ? "" : l.texts.length ? scrubAll(o[k] as string, l.texts) : o[k];
    return o;
  };
  const r = await walk(v);
  return r === DROP ? {} : r;
}
const DROP = Symbol("drop");

/**
 * The read gate's files half. `phase` before: a write an agent may not make (carry a file out of its layer). `phase` after: the output an agent may have. Every capability named here is one an agent
 * reaches content or names through; anything else comes back as it was.
 */
export async function agentGate(ctx: Ctx, input: unknown): Promise<Gate> {
  const o = isObj(input) ? input : {};
  const cap = str(o.cap), inp = o.input, out = o.output, w = (isObj(o.who) ? o.who : { principal: { kind: "agent", id: "" } }) as unknown as Who;
  const fid = fileIdIn(inp);
  if (str(o.phase) === "before") {
    if (CARRY.has(cap)) {
      if (fid) { const s = await stateOf(ctx, fid); if (s && s.state !== "clear") return { refuse: { code: "permission.no_grant", message: `${str(s.file.name)} has parts hidden from AI, so an agent may not copy, move or send it. A person can.`, details: { reason: "redacted_file", fileId: fid } } }; }
      const folderId = isObj(inp) && typeof inp.folderId === "string" ? inp.folderId : undefined;
      if (folderId && await unclearBelow(ctx, folderId)) return { refuse: { code: "permission.no_grant", message: "Something in this folder is hidden from AI, so an agent may not move it. A person can.", details: { reason: "redacted_folder", folderId } } };
    }
    return { output: out };
  }
  // a folder handed to a CLI engine on a person's computer, read straight from disk: only folders with nothing hidden from AI below them
  if (cap === "mounts.engine_folders" && isObj(out) && Array.isArray(out.folders)) {
    const keep: unknown[] = [];
    for (const f of out.folders) if (!(isObj(f) && typeof f.folderId === "string" && await unclearBelow(ctx, f.folderId))) keep.push(f);
    return { output: { ...out, folders: keep } };
  }
  // a git working tree and its diffs hold every file's bytes
  if (cap.startsWith("git.") && isObj(inp) && typeof inp.folderId === "string" && ["git.diff", "git.show", "git.status", "git.log", "git.blame", "git.file"].includes(cap) && await unclearBelow(ctx, inp.folderId)) {
    if (cap === "git.log" || cap === "git.status") return { output: await namesPass(ctx, out, new Map()) };
    return { refuse: { code: "permission.no_grant", message: "Something in this repository's folder is hidden from AI, so its diffs are not shown to agents. A person can open them.", details: { reason: "redacted_folder", folderId: inp.folderId } } };
  }
  // a connector call that reaches a mounted provider file (Drive, OneDrive, SharePoint): its content cannot carry [REDACTED], so anything not clear is refused; read it through Files instead
  if (cap === "connector.content") {
    const folderId = isObj(inp) && typeof inp.folderId === "string" ? inp.folderId : undefined;
    if (fid) {
      const s = await stateOf(ctx, fid);
      if (s?.state === "off") return refuseOff(str(s.file.name), fid);
      if (s?.state === "needs") return refuseNeeds(str(s.file.name), fid, askToRedact(ctx, s.file, w));
      if (s?.state === "redacted") return { refuse: { code: "permission.no_grant", message: `${str(s.file.name)} has parts hidden from AI. Read it through Files (files_read): you get it with [REDACTED] where they are.`, details: { reason: "redacted_file", fileId: fid } } };
      if (s) noteRead(ctx, s, w);
    } else if (folderId && accessOf(ctx, { folderId }).value === "off") return { refuse: { code: "permission.no_grant", message: "This folder is not available to AI.", details: { reason: "agent_access_off", folderId } } };
    return { output: out };
  }
  if (cap === "changesets.diff" || cap === "changesets.get") {
    const csId = isObj(inp) && typeof inp.changesetId === "string" ? inp.changesetId : "";
    const ids = csId ? many(ctx, "SELECT file_id FROM files_changeset_file WHERE changeset_id = ?", csId).map((r) => str(r.file_id)).filter(Boolean) : [];
    let texts: string[] = [];
    for (const id of ids) { const s = await stateOf(ctx, id); if (!s) continue; if (s.state === "off") return refuseOff(str(s.file.name), id); if (s.state === "needs") return refuseNeeds(str(s.file.name), id, askToRedact(ctx, s.file, w)); texts = texts.concat(redactedTexts(s.marks)); }
    return { output: scrubDeep(await namesPass(ctx, out, new Map()), texts) };
  }
  if (cap === "files.comments.list" && fid) {
    // agents see highlights, never comments, on a file with a layer or in a Redacted or Not available folder
    const s = await stateOf(ctx, fid);
    if (s && (s.state !== "clear" || s.access.value !== "on")) return { output: { ...(isObj(out) ? out : {}), comments: [] } };
    return { output: out };
  }
  if (CONTENT.has(cap) && fid) {
    const s = await stateOf(ctx, fid);
    if (!s) return { output: out };
    const name = str(s.file.name);
    if (s.state === "off") return refuseOff(name, fid);
    if (s.state === "needs") return refuseNeeds(name, fid, askToRedact(ctx, s.file, w));
    if (s.state === "clear") { noteRead(ctx, s, w); return { output: await namesPass(ctx, out, new Map()) }; }
    const texts = redactedTexts(s.marks), hasRed = texts.length > 0 || s.marks.some((m) => m.kind === "redact");
    if (PICTURES.has(cap) || cap === "files.markup.get") { if (hasRed) return refuseBinary(name, fid); noteRead(ctx, s, w); return { output: await namesPass(ctx, out, new Map()) }; }
    if (cap === "files.read" && isObj(out)) {
      const versionId = isObj(inp) && typeof inp.versionId === "string" ? inp.versionId : undefined;
      if (typeof out.text === "string") {
        const whole = await agentText(ctx, s, versionId);
        const off = isObj(inp) ? optInt(ctx, inp, "offset") ?? 0 : 0, len = isObj(inp) ? optInt(ctx, inp, "length") : undefined;
        const text = whole === null ? scrubAll(out.text, texts) : whole.slice(Math.min(off, whole.length), len === undefined ? undefined : off + len);
        noteRead(ctx, s, w);
        return { output: { ...out, text, truncated: whole === null ? out.truncated : off > 0 || (len !== undefined && off + len < whole.length) } };
      }
      if (typeof out.base64 === "string" || typeof out.url === "string") {
        if (!hasRed) { noteRead(ctx, s, w); return { output: out }; }
        const mime = str(out.mime);
        if (typeof out.base64 === "string" && (mime.startsWith("text/") || mime === "application/json")) {
          const whole = (await agentText(ctx, s, versionId)) ?? "";
          const bytes = new TextEncoder().encode(whole);
          noteRead(ctx, s, w);
          return { output: { ...out, base64: bytesToB64(bytes), size: bytes.byteLength, truncated: false } };
        }
        return refuseBinary(name, fid);
      }
    }
    noteRead(ctx, s, w);
    const scrubbed = scrubDeep(out, texts);
    return { output: await namesPass(ctx, isObj(scrubbed) && "previewUrl" in scrubbed && hasRed ? { ...scrubbed, previewUrl: undefined } : scrubbed, new Map()) };
  }
  // anything else an agent reads through a files, search or memory capability: names, paths and snippets
  return { output: await namesPass(ctx, out, new Map()) };
}

// ---- capabilities ----

const mustPerson = (ctx: Ctx, what: string): void => { if (ctx.principal.kind !== "person") fail(ctx, "permission.role_lacks_permission", `Only a person can ${what}.`, { reason: "person_only" }); };
const reqId = (ctx: Ctx, o: O, k: string): string => { const v = optStr(ctx, o, k); if (!v) fail(ctx, "validation.bad_input", "The input is not valid.", { field: k }); return v; };
const markOut = (r: Row): O => ({
  markId: str(r.id), targetId: str(r.target_id), version: num(r.version), kind: str(r.kind), shape: str(r.shape), ...(r.text !== null && r.text !== undefined ? { text: str(r.text) } : {}),
  ...(r.occurrence !== null && r.occurrence !== undefined ? { occurrence: num(r.occurrence) } : {}), ...(r.page !== null && r.page !== undefined ? { page: num(r.page) } : {}),
  ...(typeof r.box === "string" && r.box ? { box: JSON.parse(r.box) } : {}), ...(r.range_from !== null && r.range_from !== undefined ? { from: num(r.range_from), to: num(r.range_to) } : {}),
  ...(r.label ? { label: str(r.label) } : {}), by: str(r.by), ...(r.by_agent ? { byAgent: str(r.by_agent) } : {}), ...(r.via ? { via: str(r.via) } : {}), at: num(r.at), unplaced: num(r.unplaced) === 1,
});
/** The target of a call: `target` {type, id} (the manifest's shape), or fileId / folderId. */
const targetIds = (o: O): { fileId?: string; folderId?: string } => {
  if (isObj(o.target) && typeof o.target.id === "string") return o.target.type === "folder" ? { folderId: o.target.id } : { fileId: o.target.id };
  return { ...(typeof o.fileId === "string" ? { fileId: o.fileId } : {}), ...(typeof o.folderId === "string" ? { folderId: o.folderId } : {}) };
};
const targetOf = (ctx: Ctx, o: O): { kind: "file" | "folder"; id: string; row: Row } => {
  const { fileId, folderId } = targetIds(o);
  if (fileId) { const row = fileRow(ctx, fileId); if (!row) fail(ctx, "validation.not_found", "That file is not here.", { fileId }); return { kind: "file", id: fileId, row }; }
  if (folderId) { const row = folderRow(ctx, folderId); if (!row) fail(ctx, "validation.not_found", "That folder is not here.", { folderId }); return { kind: "folder", id: folderId, row }; }
  return fail(ctx, "validation.bad_input", "Give a fileId or a folderId.", { field: "fileId" });
};
function overridesBelow(ctx: Ctx, folderId: string): O[] {
  const out: O[] = [], ids = [folderId], seen = new Set(ids);
  for (let i = 0; i < ids.length && i < 5000; i++) {
    for (const c of many(ctx, "SELECT id, name FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", ids[i])) {
      const k = str(c.id); if (seen.has(k)) continue; seen.add(k); ids.push(k);
      const s = setting(ctx, "folder", k); if (s) out.push({ kind: "folder", id: k, name: str(c.name), value: str(s.value) });
    }
    for (const f of many(ctx, "SELECT id, name FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", ids[i])) { const s = setting(ctx, "file", str(f.id)); if (s) out.push({ kind: "file", id: str(f.id), name: str(f.name), value: str(s.value) }); }
  }
  return out;
}
function accessReply(ctx: Ctx, t: { kind: "file" | "folder"; id: string }): O {
  const a = accessOf(ctx, t.kind === "file" ? { fileId: t.id } : { folderId: t.id });
  const parent = t.kind === "file" ? str(fileRow(ctx, t.id)?.folder_id) : str(folderRow(ctx, t.id)?.parent_id);
  const inherited = parent ? accessOf(ctx, { folderId: parent }).value : "on";
  const files = t.kind === "folder" ? folderChainDown(ctx, t.id).length : 0;
  return { value: a.value, own: a.own, inherited, ...(a.from ? { from: a.from } : {}), ...(a.setBy ? { setBy: a.setBy, setAt: a.setAt } : {}), ...(t.kind === "folder" ? { overrides: overridesBelow(ctx, t.id), files } : {}) };
}
/** File ids that follow a folder's setting (no setting of their own and no folder in between with one). */
function folderChainDown(ctx: Ctx, folderId: string): string[] {
  const out: string[] = [], walk = [folderId], seen = new Set(walk);
  for (let i = 0; i < walk.length && i < 5000; i++) {
    for (const f of many(ctx, "SELECT id FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", walk[i])) if (!setting(ctx, "file", str(f.id))) out.push(str(f.id));
    for (const c of many(ctx, "SELECT id FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", walk[i])) { const k = str(c.id); if (!seen.has(k) && !setting(ctx, "folder", k)) { seen.add(k); walk.push(k); } }
  }
  return out;
}

async function accessGet(ctx: Ctx, input: unknown): Promise<O> { const t = targetOf(ctx, rec(ctx, input)); return accessReply(ctx, t); }
async function accessSet(ctx: Ctx, input: unknown): Promise<O> {
  mustPerson(ctx, "change what agents may read");
  const o = rec(ctx, input), t = targetOf(ctx, o), v = o.value;
  if (v !== null && v !== undefined && !isAgentAccess(v)) fail(ctx, "validation.bad_input", "value is on, redact, off or null.", { field: "value" });
  if (v === null || v === undefined) ctx.db.run("DELETE FROM files_agent_access WHERE target_kind = ? AND target_id = ?", t.kind, t.id);
  else ctx.db.run("INSERT INTO files_agent_access (target_kind, target_id, value, set_by, set_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(target_kind, target_id) DO UPDATE SET value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at", t.kind, t.id, v, person(ctx), ctx.now());
  const now = accessOf(ctx, t.kind === "file" ? { fileId: t.id } : { folderId: t.id }).value;
  ctx.emit(t.kind === "file" ? "file.agent_access_changed" : "folder.agent_access_changed", `${t.kind}/${t.id}`, { [t.kind === "file" ? "fileId" : "folderId"]: t.id, value: now, own: v !== null && v !== undefined, by: person(ctx) });
  return accessReply(ctx, t);
}

async function marksList(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), fileId = reqId(ctx, o, "fileId");
  const s = await stateOf(ctx, fileId);
  if (!s) fail(ctx, "validation.not_found", "That file is not here.", { fileId });
  const rows = liveRows(ctx, fileId);
  const reqs = many(ctx, "SELECT * FROM files_redact_request WHERE file_id = ? AND state = ?", fileId, "waiting");
  const st = s.state === "off" ? "off" : s.state === "needs" ? "needs_review" : s.access.value === "redact" ? "reviewed" : "available";
  return {
    state: st, access: accessReply(ctx, { kind: "file", id: fileId }), version: num(s.file.version),
    ...(s.reviewed ? { reviewed: s.reviewed } : {}),
    marks: rows.filter((r) => num(r.unplaced) === 0).map(markOut), unplaced: rows.filter((r) => num(r.unplaced) === 1).map(markOut),
    names: nameMarks(ctx, null, str(s.file.folder_id)).map((m) => ({ markId: m.id, text: m.text ?? "" })).concat(rows.filter((r) => str(r.shape) === "name").map((r) => ({ markId: str(r.id), text: str(r.text) }))),
    requests: reqs.map((r) => ({ requestId: str(r.id), ...(r.agent ? { agentId: str(r.agent) } : {}), ...(r.asker ? { actingFor: str(r.asker) } : {}), at: num(r.at) })),
  };
}

async function marksAdd(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), ids = targetIds(o), targetId = ids.fileId ?? ids.folderId ?? reqId(ctx, o, "fileId");
  const isFolder = !ids.fileId;
  const file = isFolder ? undefined : fileRow(ctx, targetId);
  if (!isFolder && !file) fail(ctx, "validation.not_found", "That file is not here.", { fileId: targetId });
  if (isFolder && !folderRow(ctx, targetId)) fail(ctx, "validation.not_found", "That folder is not here.", { folderId: targetId });
  const kind = optStr(ctx, o, "kind") ?? "redact", shape = optStr(ctx, o, "shape") ?? "span";
  if (!["redact", "highlight"].includes(kind)) fail(ctx, "validation.bad_input", "kind is redact or highlight.", { field: "kind" });
  if (!["span", "box", "range", "name"].includes(shape)) fail(ctx, "validation.bad_input", "shape is span, box, range or name.", { field: "shape" });
  if (isFolder && shape !== "name") fail(ctx, "validation.bad_input", "A folder takes only a name redaction.", { field: "shape" });
  const text = optStr(ctx, o, "text");
  const box = isObj(o.box) ? { x: Number(o.box.x), y: Number(o.box.y), w: Number(o.box.w), h: Number(o.box.h) } : null;
  if ((shape === "span" || shape === "name") && !text?.trim()) fail(ctx, "validation.bad_input", "A span or a name piece needs the text it covers.", { field: "text" });
  if (shape === "box" && (!box || ![box.x, box.y, box.w, box.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) || box.w <= 0 || box.h <= 0)) fail(ctx, "validation.bad_input", "A box is x, y, w, h as fractions of the page.", { field: "box" });
  if (shape === "range" && !(typeof o.from === "number" && typeof o.to === "number" && o.to > o.from)) fail(ctx, "validation.bad_input", "A range is from and to, in seconds.", { field: "from" });
  if (shape === "name") {
    const name = isFolder ? str(folderRow(ctx, targetId)?.name) : str(file?.name);
    if (!text || !name.includes(text)) fail(ctx, "validation.bad_input", "A name piece must be part of the name.", { field: "text" });
  }
  const id = nid(ctx, "mrk"), occ = typeof o.occurrence === "number" ? Math.max(0, Math.floor(o.occurrence)) : null;
  const label = optStr(ctx, o, "label") ?? (kind === "redact" && text ? classify(text) : null);
  ctx.db.run(
    "INSERT INTO files_mark (id, target_id, version, kind, shape, text, occurrence, page, box, range_from, range_to, label, by, by_agent, via, at, unplaced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    id, targetId, file ? num(file.version) : 0, kind, shape, text ?? null, occ, optInt(ctx, o, "page") ?? null, box ? JSON.stringify(box) : null,
    typeof o.from === "number" ? o.from : null, typeof o.to === "number" ? o.to : null, label, person(ctx), ctx.principal.kind === "agent" ? ctx.principal.id : null, optStr(ctx, o, "via") ?? null, ctx.now(),
  );
  const row = one(ctx, "SELECT * FROM files_mark WHERE id = ?", id)!;
  ctx.emit(kind === "redact" ? "file.redacted" : "file.highlighted", `${isFolder ? "folder" : "file"}/${targetId}`, { ...(isFolder ? { folderId: targetId } : { fileId: targetId }), markId: id, shape, ...(label ? { label } : {}), by: person(ctx), ...(ctx.principal.kind === "agent" ? { byAgent: ctx.principal.id } : {}) });
  return { mark: markOut(row) };
}

async function marksRemove(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), id = reqId(ctx, o, "markId");
  const row = one(ctx, "SELECT * FROM files_mark WHERE id = ?", id);
  if (!row || row.removed_at !== null && row.removed_at !== undefined) fail(ctx, "validation.not_found", "That mark is not here.", { markId: id });
  // an agent may add a redaction but never take one off: it would read what it hides
  if (str(row.kind) === "redact") mustPerson(ctx, "un-redact");
  ctx.db.run("UPDATE files_mark SET removed_at = ?, removed_by = ? WHERE id = ?", ctx.now(), person(ctx), id);
  const target = str(row.target_id), isFolder = !fileRow(ctx, target);
  ctx.emit(str(row.kind) === "redact" ? "file.unredacted" : "file.highlight_removed", `${isFolder ? "folder" : "file"}/${target}`, { ...(isFolder ? { folderId: target } : { fileId: target }), markId: id, shape: str(row.shape), ...(row.label ? { label: str(row.label) } : {}), by: person(ctx) });
  return { removed: true };
}

/** A redaction a new version could not place: put it on a near match, or drop it. */
async function marksPlace(ctx: Ctx, input: unknown): Promise<O> {
  mustPerson(ctx, "place a redaction");
  const o = rec(ctx, input), id = reqId(ctx, o, "markId");
  const row = one(ctx, "SELECT * FROM files_mark WHERE id = ?", id);
  if (!row || num(row.unplaced) !== 1 || row.removed_at !== null && row.removed_at !== undefined) fail(ctx, "validation.not_found", "That redaction is not waiting to be placed.", { markId: id });
  const file = fileRow(ctx, str(row.target_id));
  if (!file) fail(ctx, "validation.not_found", "That file is not here.", {});
  const text = optStr(ctx, o, "text");
  if (o.drop !== true && !text) fail(ctx, "validation.bad_input", "Give the text to place it on, or drop: true.", { field: "text" });
  if (o.drop === true) ctx.db.run("UPDATE files_mark SET removed_at = ?, removed_by = ? WHERE id = ?", ctx.now(), person(ctx), id);
  else ctx.db.run("UPDATE files_mark SET text = ?, occurrence = NULL, version = ?, unplaced = 0 WHERE id = ?", text, num(file.version), id);
  ctx.emit(o.drop === true ? "file.unredacted" : "file.redacted", `file/${str(file.id)}`, { fileId: str(file.id), markId: id, shape: str(row.shape), ...(row.label ? { label: str(row.label) } : {}), by: person(ctx), ...(o.drop === true ? { dropped: true } : { placed: true }) });
  if (!liveRows(ctx, str(file.id)).some((r) => num(r.unplaced) === 1 && str(r.kind) === "redact")) {
    const rev = one(ctx, "SELECT * FROM files_review WHERE file_id = ?", str(file.id));
    if (rev && str(rev.state) === "needs") ctx.db.run("DELETE FROM files_review WHERE file_id = ?", str(file.id));
  }
  return { ok: true };
}

/** Mark reviewed, or Done on a request: agents may now read the redacted version, and every agent that asked is told. */
async function review(ctx: Ctx, input: unknown): Promise<O> {
  mustPerson(ctx, "mark a file reviewed");
  const o = rec(ctx, input), fileId = reqId(ctx, o, "fileId");
  const s = await stateOf(ctx, fileId);
  if (!s) fail(ctx, "validation.not_found", "That file is not here.", { fileId });
  if (s.unplaced > 0) fail(ctx, "validation.precondition_failed", "Place or drop the redactions the new version could not carry over first.", { fileId, unplaced: s.unplaced });
  if (s.state === "off") fail(ctx, "validation.precondition_failed", "This file is not available to AI, so there is nothing to review.", { fileId });
  putReview(ctx, fileId, num(s.file.version), "reviewed", person(ctx));
  const waiting = many(ctx, "SELECT * FROM files_redact_request WHERE file_id = ? AND state = ?", fileId, "waiting");
  for (const r of waiting) {
    ctx.db.run("UPDATE files_redact_request SET state = 'done', done_by = ?, done_at = ? WHERE id = ?", person(ctx), ctx.now(), str(r.id));
    ctx.emit("file.redact_ready", `file/${fileId}`, { requestId: str(r.id), fileId, name: str(s.file.name), by: person(ctx), ...(r.agent ? { agentId: str(r.agent) } : {}), ...(r.asker ? { actingFor: str(r.asker) } : {}), ...(r.thread ? { threadId: str(r.thread) } : {}), ...(r.task_id ? { taskId: str(r.task_id) } : {}) });
  }
  ctx.emit("file.reviewed", `file/${fileId}`, { fileId, version: num(s.file.version), by: person(ctx), requests: waiting.length });
  return { reviewed: { by: person(ctx), at: ctx.now(), version: num(s.file.version) }, woke: waiting.length };
}

async function requestLater(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), id = reqId(ctx, o, "requestId");
  const r = one(ctx, "SELECT * FROM files_redact_request WHERE id = ?", id);
  if (!r || str(r.state) !== "waiting") fail(ctx, "validation.not_found", "That request is not waiting.", { requestId: id });
  ctx.db.run("UPDATE files_redact_request SET state = 'later', done_by = ?, done_at = ? WHERE id = ?", person(ctx), ctx.now(), id);
  return { ok: true };
}

/** An agent asks to read a file before it may ("Redact before I can read"). */
async function requestAsk(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), fileId = reqId(ctx, o, "fileId");
  const s = await stateOf(ctx, fileId);
  if (!s) fail(ctx, "validation.not_found", "That file is not here.", { fileId });
  if (s.state !== "needs") return { requestId: null, state: s.state };
  return { requestId: askToRedact(ctx, s.file, { principal: ctx.principal, ...(ctx.actingFor ? { actingFor: ctx.actingFor } : {}), ...(ctx.thread ? { thread: ctx.thread } : {}) }), state: s.state };
}

/** Names of the Space's people and contacts, for the name detector. A Space without Records answers none. */
async function recordNames(ctx: Ctx): Promise<string[]> {
  const out = new Set<string>();
  for (const [cap, inp] of [["records.query", { type: "contact", limit: 500 }], ["records.query", { type: "person", limit: 500 }]] as const) {
    try {
      const r = (await ctx.call(cap as never, inp)) as { rows?: { title?: unknown; name?: unknown; values?: O }[] };
      for (const row of r.rows ?? []) { const n = str(row.title ?? row.name ?? row.values?.["name"]).trim(); if (n.includes(" ")) out.add(n); }
    } catch { /* no Records here */ }
  }
  return [...out];
}

/** Find things to redact: server checks, no AI. Names from Records, SSNs, dates of birth, account and case numbers, phones, emails, addresses, and the file's own name. */
/** Two or more capitalised words (Elena Rivera, Dr. Amara Okafor): a redacted text a person most likely picked as a name. */
const LOOKS_LIKE_NAME = /^(?:(?:Dr|Mr|Mrs|Ms)\. )?\p{Lu}[\p{Ll}'-]+(?: \p{Lu}[\p{Ll}'-]+)+$/u;

async function detectCap(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), fileId = reqId(ctx, o, "fileId");
  const file = fileRow(ctx, fileId);
  if (!file) fail(ctx, "validation.not_found", "That file is not here.", { fileId });
  const text = (await textOf(ctx, fileId)) ?? "";
  const live = liveRows(ctx, fileId).filter((r) => str(r.kind) === "redact" && r.text);
  const have = live.map((r) => str(r.text));
  // the names already hidden here count as names too, so an email or handle built from one (elena.rivera@...) is suggested beside it: leaving it would give the name away
  const hidden = live.filter((r) => str(r.shape) === "name" || str(r.label) === "Name" || LOOKS_LIKE_NAME.test(str(r.text).trim())).map((r) => str(r.text).trim());
  const names = [...new Set([...(Array.isArray(o.names) ? o.names.filter((x): x is string => typeof x === "string") : []), ...(await recordNames(ctx)), ...hidden])];
  const found = detect(text, { names, skip: have });
  const fname = str(file.name), inName = names.flatMap((n) => n.split(" ")).filter((p) => p.length >= 3 && fname.includes(p) && !have.includes(p));
  return { suggestions: [...found, ...[...new Set(inName)].map((p) => ({ kind: "file_name", label: "Name in the file name", text: p, count: 1 }))], textLayer: text.trim() !== "", checkedBy: "patterns" };
}

/** What an agent gets of this file now: Preview as agent. */
async function agentView(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), fileId = reqId(ctx, o, "fileId");
  const s = await stateOf(ctx, fileId);
  if (!s) fail(ctx, "validation.not_found", "That file is not here.", { fileId });
  const name = agentName(str(s.file.name), nameMarks(ctx, fileId, null)), path = agentPath(ctx, str(s.file.folder_id));
  if (s.state === "off" || s.state === "needs") return { state: s.state, name, path, text: null };
  const versionId = optStr(ctx, o, "versionId");
  return { state: s.state, name, path, text: await agentText(ctx, s, versionId), boxes: s.marks.filter((m) => m.kind === "redact" && m.shape === "box").map((m) => ({ page: m.page ?? 1, box: m.box })) };
}
function agentPath(ctx: Ctx, folderId: string): string {
  return folderChain(ctx, folderId).reverse().filter((f) => !f.root_key || str(f.root_key) !== "").map((f) => agentName(str(f.name), liveRows(ctx, str(f.id)).filter((r) => str(r.shape) === "name").map(toMark))).join("/");
}

/**
 * A request to read with no chat behind it (an automation, the agent's computer): a Review task for the person the agent acts for, with the file attached. Done in Files closes it. A request made in
 * a chat is a card there instead (the engine posts it).
 */
export const redactConsumers = {
  "files.redact_request_task": {
    on: ["file.redact_requested"],
    run: async (ctx: Ctx, event: { payload: { requestId?: string; fileId?: string; name?: string; agentId?: string; actingFor?: string; threadId?: string } }): Promise<string[]> => {
      const p = event.payload;
      if (!p.requestId || !p.fileId || p.threadId || !p.actingFor?.startsWith("usr_")) return [];
      const r = one(ctx, "SELECT * FROM files_redact_request WHERE id = ?", p.requestId);
      if (!r || str(r.state) !== "waiting" || r.task_id) return [];
      const made = (await ctx.call("tasks.create" as never, {
        kind: "review", title: `Redact before an agent can read ${p.name ?? "a file"}`, summary: "It is in a Redacted folder and nobody has reviewed it yet. Open it, hide what agents should not see, then press Done.",
        assigned: { kind: "person", id: p.actingFor }, fileIds: [p.fileId], idempotencyKey: `redact-request:${p.requestId}`,
      })) as { task?: { id?: string } };
      const taskId = made.task?.id;
      if (taskId) ctx.db.run("UPDATE files_redact_request SET task_id = ? WHERE id = ?", taskId, p.requestId);
      return [p.requestId];
    },
  },
  /** Done closes the Review task a request made. */
  "files.redact_task_done": {
    on: ["file.redact_ready"],
    run: async (ctx: Ctx, event: { payload: { requestId?: string; taskId?: string } }): Promise<string[]> => {
      const taskId = event.payload.taskId; if (!taskId) return [];
      try { await ctx.call("tasks.transition" as never, { taskId, to: "done", note: "Reviewed in Files" }); } catch { /* a person closed it already */ }
      return [taskId];
    },
  },
};

/** Every file below a folder that waits for review, nearest first (bounded): the folder's "N files need review" line and Review next. */
async function needsBelow(ctx: Ctx, folderId: string, cap = 2000): Promise<string[]> {
  const out: string[] = [], walk = [folderId], seen = new Set(walk);
  for (let i = 0; i < walk.length && out.length < cap; i++) {
    for (const f of many(ctx, "SELECT id FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", walk[i])) { const st = await stateOf(ctx, str(f.id)); if (st?.state === "needs") out.push(str(f.id)); }
    for (const c of many(ctx, "SELECT id FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", walk[i])) { const k = str(c.id); if (!seen.has(k)) { seen.add(k); walk.push(k); } }
  }
  return out;
}

/** What a folder's list shows of the layer: each file's badge, each subfolder's own setting and how many below it wait, and the files to review next. */
async function agentStates(ctx: Ctx, input: unknown): Promise<O> {
  const o = rec(ctx, input), folderId = reqId(ctx, o, "folderId");
  if (!folderRow(ctx, folderId)) fail(ctx, "validation.not_found", "That folder is not here.", { folderId });
  const files: O[] = [];
  for (const f of many(ctx, "SELECT id FROM files_file WHERE folder_id = ? AND deleted_at IS NULL", folderId)) {
    const st = await stateOf(ctx, str(f.id)); if (!st) continue;
    const waiting = many(ctx, "SELECT agent FROM files_redact_request WHERE file_id = ? AND state = ?", str(f.id), "waiting");
    const badge = st.state === "off" ? "off" : st.state === "needs" ? "needs_review" : st.access.value === "redact" ? "reviewed" : st.marks.some((m) => m.kind === "redact") ? "hidden" : "clear";
    files.push({ fileId: str(f.id), state: badge, own: st.access.own, ...(waiting.length ? { waiting: waiting.map((w) => str(w.agent)).filter(Boolean) } : {}) });
  }
  const folders: O[] = [];
  for (const c of many(ctx, "SELECT id FROM files_folder WHERE parent_id = ? AND deleted_at IS NULL", folderId)) {
    const a = accessOf(ctx, { folderId: str(c.id) });
    folders.push({ folderId: str(c.id), value: a.value, own: a.own, needs: a.value === "off" ? 0 : (await needsBelow(ctx, str(c.id), 200)).length });
  }
  const queue = accessOf(ctx, { folderId }).value === "off" ? [] : await needsBelow(ctx, folderId);
  return { access: accessReply(ctx, { kind: "folder", id: folderId }), files, folders, needs: queue.length, queue: queue.slice(0, 50) };
}

export const redactHandlers = {
  "files.agent_access.get": accessGet,
  "files.agent_access.set": accessSet,
  "files.marks.list": marksList,
  "files.marks.add": marksAdd,
  "files.marks.remove": marksRemove,
  "files.marks.place": marksPlace,
  "files.review": review,
  "files.redact.request": requestAsk,
  "files.redact.later": requestLater,
  "files.redact.detect": detectCap,
  "files.agent_view": agentView,
  "files.agent_states": agentStates,
};

export { REDACTED };
