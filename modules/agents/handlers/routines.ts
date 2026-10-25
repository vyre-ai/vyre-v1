// agents: routines, suggestions, the Agent template and the built-in guide and skills (spec 2.6, 3.2; ARCH 6.10, 7.2).
//   routines.list / routine.save / routine.delete   a routine is the schedule one person set for an agent; only that person sees, edits or deletes it. A message the agent posts because of it
//                                                   carries chat.post `via` { routineOwner } and the label "Sent by <agent> on a routine <person> set" (routineLabel, routineVia).
//   suggestions.list / suggestion.propose / .accept / .dismiss   changes to AGENT.md as diffs; accepted ones are applied through files.save as a version; ones that widen access need an admin
//   template.get / .preview / .apply                the Agent template: add, never remove, never overwrite; changed files become suggestions; try one agent first
//   guide.get / builtin_skills.list                 Vyre's own text, rewritten by app updates
import {
  BUILTIN_SKILLS, GUIDE_MD, GUIDE_VERSION, MAX_DIFF, MAX_PROMPT, TREE_FOLDERS, agentBy, allAgents, allows, applyUnifiedDiff, askerOf, call, canSee, ensure, fingerprint, insertSuggestion, makeFile,
  makeFolder, messageOf, meta, mintId, nextRun, parseCron, raise, routineBy, routineOf, routineOut, setMeta, simpleDiff, saveFile, suggestionBy, suggestionOf, suggestionOut, textOf, tolerant, visible, walkFolder,
} from "../projections.ts";
import type { AgentRec, AgentsCtx, FolderOut, RoutineRec, SuggestionRec } from "../projections.ts";

type Row = Record<string, unknown>;
const by = (ctx: AgentsCtx): string => ctx.actingFor ?? ctx.principal.id;

// ---- routines -------------------------------------------------------------------------------------------------------------------------------------------

export async function routinesList(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  // Nobody else sees a routine, whatever they may do with the agent: the rows are the asker's own.
  const rows = (ctx.db.all("SELECT * FROM agents_routine WHERE agentId = ? AND ownerId = ? ORDER BY createdAt, id", a.id, askerOf(ctx)) as Row[]);
  return { routines: rows.map((r) => routineOut(routineOf(r))) };
}

export async function routineSave(ctx: AgentsCtx, input: { agentId: string; routineId?: string; title: string; cron: string; prompt: string; channelId?: string; enabled?: boolean; idempotencyKey?: string }) {
  ensure(ctx.db);
  const agent = agentBy(ctx.db, input.agentId);
  if (!agent || !canSee(ctx, agent)) raise(ctx, "validation.bad_input", "That agent does not exist.");
  const title = input.title.trim();
  if (title === "" || title.length > 120) raise(ctx, "validation.bad_input", "Give the routine a title of up to 120 characters.");
  if (parseCron(input.cron) === null) raise(ctx, "validation.bad_input", 'The schedule needs five fields, like "0 9 * * 1-5" (minute, hour, day of the month, month, day of the week).', { cron: input.cron });
  if (input.prompt.trim() === "" || input.prompt.length > MAX_PROMPT) raise(ctx, "validation.bad_input", `The routine needs a prompt of up to ${MAX_PROMPT} characters.`);
  if (input.channelId !== undefined && !input.channelId.startsWith("chn_")) raise(ctx, "validation.bad_input", "That is not a channel.", { channelId: input.channelId });
  const owner = askerOf(ctx);
  const now = ctx.now();
  const enabled = input.enabled !== false;
  const next = enabled ? nextRun(input.cron, now) : null;
  if (input.routineId !== undefined) {
    // Someone else's routine is answered like one that does not exist.
    const old = routineBy(ctx.db, input.routineId);
    if (!old || old.ownerId !== owner || old.agentId !== agent.id) raise(ctx, "validation.bad_input", "That routine does not exist.");
    ctx.db.run(
      "UPDATE agents_routine SET title = ?, cron = ?, prompt = ?, channelId = ?, enabled = ?, nextRunAt = ?, updatedAt = ? WHERE id = ?",
      title, input.cron.trim(), input.prompt, input.channelId ?? null, enabled ? 1 : 0, next, now, old.id,
    );
    ctx.emit("agent.routine_changed", agent.id, { agentId: agent.id, routineId: old.id, op: "updated" });
    return { routine: routineOut(routineBy(ctx.db, old.id) as RoutineRec) };
  }
  const id = mintId("rtn", now);
  ctx.db.run(
    "INSERT INTO agents_routine (id, agentId, ownerId, title, cron, prompt, channelId, enabled, nextRunAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, agent.id, owner, title, input.cron.trim(), input.prompt, input.channelId ?? null, enabled ? 1 : 0, next, now, now,
  );
  ctx.emit("agent.routine_changed", agent.id, { agentId: agent.id, routineId: id, op: "created" });
  return { routine: routineOut(routineBy(ctx.db, id) as RoutineRec) };
}

export async function routineDelete(ctx: AgentsCtx, input: { agentId: string; routineId: string }) {
  ensure(ctx.db);
  const agent = agentBy(ctx.db, input.agentId);
  const r = routineBy(ctx.db, input.routineId);
  if (!agent || !canSee(ctx, agent) || !r || r.agentId !== agent.id || r.ownerId !== askerOf(ctx)) raise(ctx, "validation.not_found", "That routine does not exist.");
  ctx.db.run("DELETE FROM agents_routine WHERE id = ?", r.id);
  ctx.emit("agent.routine_changed", agent.id, { agentId: agent.id, routineId: r.id, op: "deleted" });
  return { deleted: true };
}

// ---- suggestions ---------------------------------------------------------------------------------------------------------------------------------------------

/** A diff that gives an agent more room: a line that overrides VYRE.md. Only an admin accepts one. */
export const diffWidens = (diffOrText: string): boolean => /^\+?\s*Override:/m.test(diffOrText.split("\n").filter((l) => !l.startsWith("-") && !l.startsWith("---")).join("\n"));

export async function suggestionsList(ctx: AgentsCtx, input: { agentId?: string; kind?: "agent_md" | "template"; state?: Array<"open" | "accepted" | "dismissed">; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const rows = (ctx.db.all("SELECT * FROM agents_suggestion ORDER BY proposedAt DESC, id") as Row[]).map(suggestionOf)
    .filter((s) => (input.agentId === undefined || s.agentId === input.agentId) && (input.kind === undefined || s.kind === input.kind) && (!input.state || input.state.includes(s.state)))
    .filter((s) => { const a = agentBy(ctx.db, s.agentId); return a !== null && canSee(ctx, a); });
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const limit = input.limit ?? 100;
  return { suggestions: rows.slice(offset, offset + limit).map(suggestionOut), ...(offset + limit < rows.length ? { next: String(offset + limit) } : {}), total: rows.length };
}

export async function suggestionPropose(ctx: AgentsCtx, input: { agentId: string; file?: string; diff: string; reason?: string; idempotencyKey?: string }) {
  const a = visible(ctx, input.agentId, "validation.bad_input");
  const file = input.file ?? "AGENT.md";
  if (file !== "AGENT.md") raise(ctx, "validation.bad_input", "Only AGENT.md takes suggestions; agent.toml is the owner's to write.");
  if (input.diff.trim() === "" || input.diff.length > MAX_DIFF) raise(ctx, "validation.bad_input", `A suggestion is a diff of up to ${MAX_DIFF} characters.`);
  if (a.agentMdFileId === undefined) raise(ctx, "validation.bad_input", "This agent has no AGENT.md yet.");
  const current = await textOf(ctx, a.agentMdFileId);
  const after = applyUnifiedDiff(current, input.diff);
  if (after === null) raise(ctx, "validation.bad_input", "The diff does not apply to the AGENT.md as it is now. Read the file again and propose against that.");
  if (after.split("\n").length > 151) raise(ctx, "validation.bad_input", "AGENT.md stays under 150 lines; this change would make it longer.");
  const now = ctx.now();
  const s: SuggestionRec = {
    id: mintId("sug", now), agentId: a.id, kind: "agent_md", file, diff: input.diff, widening: diffWidens(input.diff), state: "open", proposedBy: by(ctx), proposedAt: now, after,
    ...(input.reason !== undefined && input.reason.trim() !== "" ? { reason: input.reason.trim() } : {}),
  };
  insertSuggestion(ctx.db, s);
  ctx.emit("agent.suggestion_proposed", a.id, { suggestionId: s.id, agentId: a.id, kind: s.kind, by: s.proposedBy });
  return { suggestion: suggestionOut(s) };
}

/** Write a guidance file through files.save (snapshot, lint, version); any other file of the agent through files.write. */
async function writeText(ctx: AgentsCtx, fileId: string, path: string, text: string, reason: string): Promise<string> {
  const name = path.split("/").pop() as string;
  const guidance = name === "AGENT.md" || name === "agent.toml" || name === "VYRE.md" || (path.split("/").includes("routines") && /\.(md|txt)$/i.test(name));
  if (guidance) return (await saveFile(ctx, fileId, text, reason)).versionId;
  const r = await call<{ versionId?: string }>(ctx, "files.write", { fileId, content: { text }, reason });
  return r.versionId ?? "";
}

/** The file of an agent at a relative path, by walking its folder. */
async function fileAt(ctx: AgentsCtx, a: AgentRec, path: string): Promise<string | undefined> {
  if (path === "AGENT.md") return a.agentMdFileId;
  if (path === "agent.toml") return a.tomlFileId;
  if (a.folderId === undefined) return undefined;
  return (await walkFolder(ctx, a.folderId)).find((e) => e.kind === "file" && e.path === path)?.id;
}

async function resolve(ctx: AgentsCtx, s: SuggestionRec, accepted: boolean): Promise<SuggestionRec> {
  const now = ctx.now();
  ctx.db.run("UPDATE agents_suggestion SET state = ?, resolvedBy = ?, resolvedAt = ? WHERE id = ?", accepted ? "accepted" : "dismissed", by(ctx), now, s.id);
  return suggestionBy(ctx.db, s.id) as SuggestionRec;
}

export async function suggestionAccept(ctx: AgentsCtx, input: { suggestionId: string }) {
  ensure(ctx.db);
  const s = suggestionBy(ctx.db, input.suggestionId);
  const a = s ? agentBy(ctx.db, s.agentId) : null;
  if (!s || !a || !canSee(ctx, a)) raise(ctx, "validation.bad_input", "That suggestion does not exist.");
  // Shown to the owner and the editors only; everyone else could only suggest.
  if (!allows(ctx, null, "edit", "agent", a.id)) raise(ctx, "validation.precondition_failed", `Only ${a.ownerId} or someone who can edit this agent accepts a suggestion. You can suggest.`);
  if (s.state !== "open") raise(ctx, "validation.precondition_failed", `This suggestion was already ${s.state}.`);
  if (s.widening && !allows(ctx, "agents.manage", "manage", "space", null)) raise(ctx, "validation.precondition_failed", "This change gives the agent more room than the Space file allows. A Space admin has to accept it.", { taskId: s.taskId ?? null });
  const fileId = await fileAt(ctx, a, s.file);
  if (fileId === undefined) raise(ctx, "validation.precondition_failed", `${s.file} is not in this agent's folder any more.`);
  // The file may have changed since it was suggested: the diff is applied to the file as it is now, or not at all.
  const current = await textOf(ctx, fileId);
  const next = s.kind === "template" ? (s.after ?? null) : applyUnifiedDiff(current, s.diff);
  if (next === null) raise(ctx, "validation.precondition_failed", `${s.file} changed since this was suggested. Ask for it again.`);
  const versionId = await writeText(ctx, fileId, s.file, next, `Accepted a suggestion${s.reason ? `: ${s.reason}` : ""}`);
  const done = await resolve(ctx, s, true);
  ctx.emit("agent.suggestion_resolved", a.id, { suggestionId: s.id, agentId: a.id, accepted: true, by: by(ctx) });
  ctx.emit("agent.config_changed", a.id, { agentId: a.id, fields: [s.file], ...(versionId !== "" ? { versionId } : {}), by: by(ctx) });
  return { suggestion: suggestionOut(done) };
}

export async function suggestionDismiss(ctx: AgentsCtx, input: { suggestionId: string }) {
  ensure(ctx.db);
  const s = suggestionBy(ctx.db, input.suggestionId);
  const a = s ? agentBy(ctx.db, s.agentId) : null;
  if (!s || !a || !canSee(ctx, a)) raise(ctx, "validation.bad_input", "That suggestion does not exist.");
  if (!allows(ctx, null, "edit", "agent", a.id)) raise(ctx, "permission.no_grant", "You can read this agent but not change it.");
  if (s.state !== "open") return { suggestion: suggestionOut(s) };
  const done = await resolve(ctx, s, false);
  ctx.emit("agent.suggestion_resolved", a.id, { suggestionId: s.id, agentId: a.id, accepted: false, by: by(ctx) });
  return { suggestion: suggestionOut(done) };
}

// ---- the Agent template -------------------------------------------------------------------------------------------------------------------------------

export interface TemplateItem {
  path: string; kind: "folder" | "file";
  /** starter: made with the agent and the agent's from then on. app: Vyre's text, rewritten by updates. shared: the Space's file; a changed one reaches an agent as a suggestion. */
  mode: "starter" | "app" | "shared";
  text?: string;
}
export interface Template { items: TemplateItem[]; fingerprint: string }

const STARTERS: readonly TemplateItem[] = [
  { path: "memory/MAP.md", kind: "file", mode: "starter", text: "# Map\n\nWhat this agent knows and where it lives. Keep it under 200 lines.\n" },
  { path: ".vyre/guide.md", kind: "file", mode: "app", text: GUIDE_MD },
];

/** The built-in tree and files, with whatever the Space's "Agent template" folder adds or changes. agent.toml is never part of it: the owner writes that. */
export async function readTemplate(ctx: AgentsCtx): Promise<Template> {
  const items = new Map<string, TemplateItem>();
  for (const f of TREE_FOLDERS) items.set(f, { path: f, kind: "folder", mode: "starter" });
  for (const i of STARTERS) items.set(i.path, i);
  const found = await tolerant<{ folders?: FolderOut[] }>(ctx, "files.folder.search", { q: "Agent template", scope: "folders", limit: 20 }, {});
  const home = (found.folders ?? []).find((f) => f.name === "Agent template" && (f.parentId === undefined || f.path === "Agent template"));
  if (home) {
    try {
      for (const e of await walkFolder(ctx, home.folderId, 300)) {
        if (e.path === "agent.toml") continue;
        if (e.kind === "folder") { items.set(e.path, { path: e.path, kind: "folder", mode: "starter" }); continue; }
        const text = (await call<{ text?: string }>(ctx, "files.read", { fileId: e.id, as: "text" })).text ?? "";
        items.set(e.path, { path: e.path, kind: "file", mode: e.path === "AGENT.md" ? "starter" : e.path === ".vyre/guide.md" ? "app" : "shared", text });
      }
    } catch (e) { ctx.log.warn("agents: the Agent template could not be read in full", { error: messageOf(e).slice(0, 200) }); }
  }
  const list = [...items.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { items: list, fingerprint: fingerprint(list.map((i) => `${i.kind}:${i.mode}:${i.path}:${i.text ?? ""}`).join("\n")) };
}

/** The template's version: 1 at first, one more every time its contents change. */
export async function templateVersion(ctx: AgentsCtx, t?: Template): Promise<number> {
  ensure(ctx.db);
  const tpl = t ?? await readTemplate(ctx);
  const stored = Number(meta(ctx.db, "template.version") ?? "0");
  const fp = meta(ctx.db, "template.fp");
  if (stored === 0) { setMeta(ctx.db, "template.version", "1"); setMeta(ctx.db, "template.fp", tpl.fingerprint); return 1; }
  if (fp !== tpl.fingerprint) { setMeta(ctx.db, "template.version", String(stored + 1)); setMeta(ctx.db, "template.fp", tpl.fingerprint); return stored + 1; }
  return stored;
}

async function modeOf(ctx: AgentsCtx): Promise<"suggest" | "new_only" | "off"> {
  const r = await tolerant<{ row?: { value?: unknown } }>(ctx, "settings.get", { key: "agents.template_mode" }, {});
  const v = r.row?.value;
  return v === "new_only" || v === "off" ? v : "suggest";
}

interface AgentPlan {
  agent: AgentRec; folders: string[]; files: TemplateItem[]; refresh: Array<{ item: TemplateItem; fileId: string }>;
  suggestions: Array<{ item: TemplateItem; fileId: string; before: string; widening: boolean }>;
  /** path -> folder id, for placing what is added */
  folderIds: Map<string, string>;
}

/** What the template would do to one agent: folders and files it lacks (added), Vyre's own text that is out of date (rewritten), the Space's files that differ (suggested). Nothing is removed. */
async function planFor(ctx: AgentsCtx, a: AgentRec, t: Template): Promise<AgentPlan> {
  const plan: AgentPlan = { agent: a, folders: [], files: [], refresh: [], suggestions: [], folderIds: new Map() };
  if (a.folderId === undefined) return plan;
  plan.folderIds.set("", a.folderId);
  const have = new Map((await walkFolder(ctx, a.folderId)).map((e) => [e.path, e] as const));
  for (const [p, e] of have) if (e.kind === "folder") plan.folderIds.set(p, e.id);
  for (const item of t.items) {
    const there = have.get(item.path);
    if (item.kind === "folder") { if (!there) plan.folders.push(item.path); continue; }
    if (item.path === "AGENT.md" || item.path === "agent.toml") continue;
    if (!there) { plan.files.push(item); continue; }
    if (item.mode === "starter") continue;
    const text = await textOf(ctx, there.id);
    if (text === (item.text ?? "")) continue;
    if (item.mode === "app") plan.refresh.push({ item, fileId: there.id });
    else plan.suggestions.push({ item, fileId: there.id, before: text, widening: diffWidens(simpleDiff(item.path, text, item.text ?? "")) });
  }
  plan.folders.sort((x, y) => x.split("/").length - y.split("/").length || x.localeCompare(y));
  return plan;
}

function scopeAgents(ctx: AgentsCtx, input: { scope: "all" | "one"; agentId?: string }): AgentRec[] {
  ensure(ctx.db);
  if (input.scope === "one") {
    if (input.agentId === undefined) raise(ctx, "validation.bad_input", "Say which agent to try the template on.");
    return [visible(ctx, input.agentId, "validation.bad_input")];
  }
  return allAgents(ctx.db);
}

export async function templateGet(ctx: AgentsCtx, _input: Record<string, never>) {
  ensure(ctx.db);
  const t = await readTemplate(ctx);
  return { version: await templateVersion(ctx, t), files: t.items.filter((i) => i.kind === "file").map((i) => i.path), mode: await modeOf(ctx), agents: allAgents(ctx.db).length };
}

export async function templatePreview(ctx: AgentsCtx, input: { scope: "all" | "one"; agentId?: string }) {
  const agents = scopeAgents(ctx, input);
  const t = await readTemplate(ctx);
  await templateVersion(ctx, t);
  let foldersAdded = 0, filesAdded = 0, suggestions = 0, widening = 0;
  for (const a of agents) {
    const p = await planFor(ctx, a, t);
    foldersAdded += p.folders.length; filesAdded += p.files.length; suggestions += p.suggestions.length; widening += p.suggestions.filter((s) => s.widening).length;
  }
  return { agents: agents.length, foldersAdded, filesAdded, suggestions, widening };
}

export async function templateApply(ctx: AgentsCtx, input: { scope: "all" | "one"; agentId?: string }) {
  const mode = await modeOf(ctx);
  if (mode === "off") raise(ctx, "validation.bad_input", "The Agent template is switched off for this Space.");
  if (mode === "new_only" && input.scope === "all") raise(ctx, "validation.bad_input", "This Space gives the template to new agents only. Switch the mode to Suggest to apply it to the ones that exist.");
  const agents = scopeAgents(ctx, input);
  const t = await readTemplate(ctx);
  const version = await templateVersion(ctx, t);
  const now = ctx.now();
  const made: string[] = [];
  let applied = 0, widening = 0;
  for (const a of agents) {
    const p = await planFor(ctx, a, t);
    for (const path of p.folders) {
      const parts = path.split("/");
      const parent = p.folderIds.get(parts.slice(0, -1).join("/"));
      if (parent === undefined) continue;
      p.folderIds.set(path, (await makeFolder(ctx, parent, parts[parts.length - 1] as string, `agents:${a.id}:template:${version}:folder:${path}`)).folderId);
    }
    for (const f of p.files) {
      const parts = f.path.split("/");
      const parent = p.folderIds.get(parts.slice(0, -1).join("/"));
      if (parent !== undefined) await makeFile(ctx, parent, parts[parts.length - 1] as string, f.text ?? "", `agents:${a.id}:template:${version}:file:${f.path}`);
    }
    for (const r of p.refresh) await writeText(ctx, r.fileId, r.item.path, r.item.text ?? "", "Vyre updated its guide");
    for (const s of p.suggestions) {
      const diff = simpleDiff(s.item.path, s.before, s.item.text ?? "");
      const dupe = (ctx.db.all("SELECT id FROM agents_suggestion WHERE agentId = ? AND file = ? AND state = 'open' AND afterText = ?", a.id, s.item.path, s.item.text ?? "") as Row[])[0];
      if (dupe) continue;
      const id = mintId("sug", now);
      insertSuggestion(ctx.db, { id, agentId: a.id, kind: "template", file: s.item.path, diff, reason: "The Agent template changed", widening: s.widening, state: "open", proposedBy: by(ctx), proposedAt: now, after: s.item.text ?? "" });
      made.push(id);
      if (s.widening) widening++;
    }
    ctx.db.run("UPDATE agents_agent SET templateVersion = ?, updatedAt = ? WHERE id = ?", version, now, a.id);
    applied++;
  }
  // Widening suggestions wait for a Space admin: one task says so, and every one of them points at it.
  let taskId: string | undefined;
  if (widening > 0) {
    const task = await tolerant<{ task?: { id?: string } }>(ctx, "tasks.create", {
      kind: "approve", title: `Review ${widening} Agent template ${widening === 1 ? "change" : "changes"} that give agents more room`, summary: "Accepting one lets an agent do something its own files did not allow.",
      assigned: { kind: "role", id: "admin" },
    }, {});
    taskId = task.task?.id;
    if (taskId !== undefined) for (const id of made) ctx.db.run("UPDATE agents_suggestion SET taskId = ? WHERE id = ? AND widening = 1", taskId, id);
  }
  ctx.emit("agent.template_applied", input.scope === "one" ? (input.agentId as string) : "all", { scope: input.scope === "one" ? `one:${input.agentId}` : "all", agents: applied, suggestions: made.length, by: by(ctx) });
  return { applied, suggestions: made.length, ...(taskId !== undefined ? { taskId } : {}) };
}

// ---- Vyre's own text ----------------------------------------------------------------------------------------------------------------------------------

export async function guideGet(_ctx: AgentsCtx, _input: Record<string, never>) {
  return { version: GUIDE_VERSION, path: ".vyre/guide.md" as const, body: GUIDE_MD };
}

export async function builtinSkillsList(_ctx: AgentsCtx, _input: Record<string, never>) {
  return { skills: BUILTIN_SKILLS.map((s) => ({ ...s })) };
}

