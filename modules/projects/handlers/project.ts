// Projects: make, read, list, people and the Overview (spec 3.4, 2.4; ARCH 7.4).
// A project is made with exactly one channel and one folder (Projects/<name>) and an empty plan. Project roles write grants through access.share with source `project:<id>` and are revoked
// by that source: Lead manage, Member edit, Reviewer and Guest view.
// DECISION: the Overview's recent decisions and linked records come from modules this one does not call yet; both lists are empty until those modules offer a read, never made up.
// DECISION: a read-only link is a token the host serves at /share/project/<token>; it lives in projects_share until it expires or is revoked.
import {
  LEVEL_OF, addFiled, addLink, addPin, allProjects, allows, buildStages, call, clean, codeOf, dropMember, dropPin, emitP, ensure, isMember, keyed, kindOfPrincipal, linksOf, loadTasks,
  me, membersOf, memberOf, newId, page, pinsOf, planTask, plansOf, projectBy, projectByChannel, projectRow, raise, readRecord, remember, replaceStages, saveMember, savePlan, saveProject, saveUpdate,
  stagesOf, tolerant, updateOf, visible, writeRecord,
} from "../projections.ts";
import type { In, Member, Project, ProjectsCtx, Role, Source, TaskView } from "../projections.ts";

interface Made { projectId: string; recordId: string; channelId: string; folderId: string }
interface FolderOut { folderId: string; parentId?: string; name: string; path?: string }

const subjectOf = (m: Pick<Member, "kind" | "principal">): { kind: string; id: string } => ({ kind: m.kind, id: m.principal });
const sourceTag = (projectId: string): string => `project:${projectId}`;

/** The resources a project role is granted on: the project, its folder and its channel. */
function resourcesOf(p: Project): Array<{ type: string; id: string }> {
  return [{ type: "project", id: p.projectId }, ...(p.folderId ? [{ type: "folder", id: p.folderId }] : []), ...(p.channelId ? [{ type: "channel", id: p.channelId }] : [])];
}

/** Tasks for counts; a project still opens when Tasks does not answer. */
async function tasksOrNone(ctx: ProjectsCtx, p: Project): Promise<TaskView[]> {
  try { return await loadTasks(ctx, p); } catch (e) {
    ctx.log.warn("projects: tasks did not answer", { project: p.projectId, error: codeOf(e) });
    return [];
  }
}

// ---- people ----

/** Give a principal a role: the previous grants of that source go, the new ones are written on the project, its folder and its channel. */
async function applyRole(ctx: ProjectsCtx, p: Project, principal: string, role: Role, announce = true): Promise<{ member: Member; previous?: Role }> {
  const kind = kindOfPrincipal(principal);
  if (!kind) raise(ctx, "validation.bad_input", "A person, an agent or a group holds a project role.", { principal });
  const before = memberOf(ctx.db, p.projectId, principal);
  const member: Member = { principal, role, kind, since: before?.since ?? ctx.now() };
  for (const r of resourcesOf(p)) {
    if (before) await call(ctx, "access.unshare", { resource: r, subject: subjectOf(member), source: sourceTag(p.projectId) });
    await call(ctx, "access.share", { resource: r, subject: subjectOf(member), level: LEVEL_OF[role], source: sourceTag(p.projectId) }, { idempotencyKey: `prj-share:${p.projectId}:${principal}:${role}:${r.type}` });
  }
  saveMember(ctx.db, p.projectId, member);
  if (role === "lead") await writeRecord(ctx, p, { lead: principal });
  // projects.create and projects.from_channel declare project.created, not project.member_set: the first people on a project are part of its creation
  if (announce) emitP(ctx, "project.member_set", p.projectId, { principal, role, previous: before?.role });
  return { member, ...(before ? { previous: before.role } : {}) };
}

export async function membersList(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  return { members: membersOf(ctx.db, p.projectId) };
}

export async function membersSet(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "manage");
  const again = keyed<{ member: Member }>(ctx.db, input.idempotencyKey, "projects.members.set");
  if (again) return again;
  const { member } = await applyRole(ctx, p, input.principal, input.role);
  const res = { member };
  remember(ctx.db, input.idempotencyKey, "projects.members.set", res);
  return res;
}

export async function membersRemove(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "manage");
  const m = memberOf(ctx.db, p.projectId, input.principal);
  if (!m) return { removed: false };
  for (const r of resourcesOf(p)) await call(ctx, "access.unshare", { resource: r, subject: subjectOf(m), source: sourceTag(p.projectId) });
  dropMember(ctx.db, p.projectId, m.principal);
  if (m.role === "lead") {
    const fields = await readRecord(ctx, p);
    if (fields["lead"] === m.principal) await writeRecord(ctx, p, { lead: null });
  }
  emitP(ctx, "project.member_removed", p.projectId, { principal: m.principal });
  return { removed: true };
}

// ---- making a project ----

async function requireProjectType(ctx: ProjectsCtx, type: string): Promise<void> {
  try {
    const r = await call<{ type?: { template?: string } }>(ctx, "schema.types.get", { type });
    if (r.type?.template !== "project") raise(ctx, "validation.bad_input", `${type} is not a project type. Journeys and the Projects type are.`, { type });
  } catch (e) {
    if (codeOf(e) === "validation.not_found") raise(ctx, "validation.bad_input", `There is no record type called ${type}.`, { type });
    throw e;
  }
}

/** The Projects folder of the Space (the root key `projects` of the Files tree). */
async function projectsRoot(ctx: ProjectsCtx): Promise<string> {
  const found = await call<{ folders?: FolderOut[] }>(ctx, "files.folder.search", { q: "Projects", scope: "folders", limit: 20 });
  const root = (found.folders ?? []).find((f) => f.name === "Projects" && f.parentId === undefined) ?? (found.folders ?? []).find((f) => f.path === "Projects");
  if (!root) raise(ctx, "internal.unexpected", "The Projects folder is missing from this Space.");
  return root.folderId;
}

interface Plan {
  type: string; title: string; summary?: string | undefined; goal?: string | undefined; lead?: string | undefined; start?: number | undefined; due?: number | undefined;
  stages: Array<{ key: string; title: string }>; members: Array<{ principal: string; role: Role }>; source: Source; key: string;
  /** From a channel: the channel that already exists and its folder, if it has one. */
  channel?: { channelId: string; threadId?: string | undefined; folderId?: string | undefined } | undefined;
}

async function makeProject(ctx: ProjectsCtx, o: Plan): Promise<Made> {
  const now = ctx.now();
  const projectId = newId("prj", now);
  const maker = me(ctx);
  const members = new Map<string, Role>();
  const lead = o.lead ?? (maker.startsWith("usr_") ? maker : undefined);
  if (lead) members.set(lead, "lead");
  for (const m of o.members) if (!members.has(m.principal) || m.role === "lead") members.set(m.principal, m.role);
  // whoever makes the project stays on it, even when someone else leads
  if (maker.startsWith("usr_") && !members.has(maker)) members.set(maker, "member");
  for (const id of members.keys()) if (!kindOfPrincipal(id)) raise(ctx, "validation.bad_input", "A person, an agent or a group holds a project role.", { principal: id });

  const rec = await call<{ record?: { id?: string } }>(ctx, "records.create", {
    type: o.type, fields: clean({ title: o.title, summary: o.summary, status: "planning", lead, start: o.start, due: o.due, goal: o.goal, stages: o.stages.map((s) => s.key) }),
  }, { idempotencyKey: `prj-rec:${o.key}` });
  const recordId = rec.record?.id;
  if (!recordId) raise(ctx, "internal.unexpected", "The project record was not created.");

  let folderId = o.channel?.folderId;
  if (!folderId) {
    const root = await projectsRoot(ctx);
    try {
      folderId = (await call<{ folder: FolderOut }>(ctx, "files.folder.create", { parentId: root, name: o.title }, { idempotencyKey: `prj-folder:${o.key}` })).folder.folderId;
    } catch (e) {
      if (codeOf(e) !== "validation.duplicate") throw e;
      // two projects may share a name; the folder takes the end of the record id to stay apart
      folderId = (await call<{ folder: FolderOut }>(ctx, "files.folder.create", { parentId: root, name: `${o.title} ${recordId.slice(-4)}` }, { idempotencyKey: `prj-folder2:${o.key}` })).folder.folderId;
    }
  }
  let channelId = o.channel?.channelId;
  let threadId = o.channel?.threadId;
  if (!channelId) {
    const ids = [...members.keys()];
    const ch = await call<{ channel?: { channelId?: string; mainThreadId?: string } }>(ctx, "channels.create", {
      name: o.title, visibility: "invite", recordId, folderId, memberIds: ids.filter((i) => i.startsWith("usr_")), agentIds: ids.filter((i) => i.startsWith("agt_")),
    }, { idempotencyKey: `prj-channel:${o.key}` });
    channelId = ch.channel?.channelId;
    threadId = ch.channel?.mainThreadId;
    if (!channelId) raise(ctx, "internal.unexpected", "The project channel was not created.");
  }

  const p: Project = { projectId, recordId, type: o.type, channelId, folderId, threadId, source: o.source, createdBy: maker, createdAt: now };
  saveProject(ctx.db, p);
  replaceStages(ctx.db, projectId, o.stages.map((s, order) => ({ key: s.key, title: s.title, order })));
  await writeRecord(ctx, p, { channel: channelId, folder: folderId });
  emitP(ctx, "project.created", projectId, { recordId, type: o.type, channelId, folderId, source: o.source });
  for (const [principal, role] of members) await applyRole(ctx, p, principal, role, false);
  return { projectId, recordId, channelId, folderId };
}

/** Copy the stages and the open tasks of a template project into a new one; dates keep their distance from the template's start. */
async function copyTemplate(ctx: ProjectsCtx, templateId: string, made: Made, start: number | undefined): Promise<void> {
  const from = projectBy(ctx.db, templateId);
  if (!from) return;
  const fields = await readRecord(ctx, from);
  const base = typeof fields["start"] === "number" ? fields["start"] : undefined;
  const shift = start !== undefined && base !== undefined ? start - base : 0;
  const plans = plansOf(ctx.db, from.projectId);
  const ids = new Map<string, string>();
  for (const t of await loadTasks(ctx, from)) {
    if (t.state === "canceled") continue;
    const plan = plans.get(t.taskId);
    const out = await call<{ task?: { id?: string } }>(ctx, "tasks.create", clean({
      title: t.title, assigned: t.assigned ? { kind: t.assigned.startsWith("agt_") ? "agent" : "person", id: t.assigned } : { kind: "person", id: me(ctx) },
      recordId: made.recordId, due: t.due === undefined ? undefined : t.due + shift,
    }), { idempotencyKey: `prj-tpl:${made.projectId}:${t.taskId}` });
    const id = out.task?.id;
    if (!id) continue;
    ids.set(t.taskId, id);
    if (plan) savePlan(ctx.db, made.projectId, id, { stage: plan.stage ?? null, start: plan.start === undefined ? null : plan.start + shift, ord: plan.ord ?? null });
  }
  for (const l of linksOf(ctx.db, from.projectId)) {
    const a = ids.get(l.from), b = ids.get(l.to);
    if (a && b) {
      await call(ctx, "tasks.dependencies.add", { taskId: b, dependsOnId: a });
      addLink(ctx.db, made.projectId, { from: a, to: b });
    }
  }
}

export async function create(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const again = keyed<Made>(ctx.db, input.idempotencyKey, "projects.create");
  if (again) return again;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) raise(ctx, "validation.bad_input", "A project needs a name.");
  if (input.start !== undefined && input.due !== undefined && input.start > input.due) raise(ctx, "validation.bad_input", "A project cannot start after it is due.");
  await requireProjectType(ctx, input.type);
  const template = typeof input.template === "string" ? input.template : undefined;
  const from = template?.startsWith("prj_") ? projectBy(ctx.db, template) : undefined;
  if (template !== undefined && !from) raise(ctx, "validation.bad_input", `There is no project template called ${template}.`, { template });
  const stages = input.stages !== undefined ? buildStages(ctx, input.stages) : from ? stagesOf(ctx.db, from.projectId) : [];
  const made = await makeProject(ctx, {
    type: input.type, title, summary: input.summary, goal: input.goal, lead: input.lead, start: input.start, due: input.due, stages: stages.map((s) => ({ key: s.key, title: s.title })),
    members: (input.members ?? []) as Array<{ principal: string; role: Role }>, source: from ? "template" : "new", key: String(input.idempotencyKey),
  });
  if (from) await copyTemplate(ctx, from.projectId, made, input.start);
  remember(ctx.db, input.idempotencyKey, "projects.create", made);
  return made;
}

export async function fromChannel(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const again = keyed<Made>(ctx.db, input.idempotencyKey, "projects.from_channel");
  if (again) return again;
  const have = projectByChannel(ctx.db, input.channelId);
  if (have) return { projectId: have.projectId, recordId: have.recordId, channelId: input.channelId, folderId: have.folderId ?? "" };
  const got = await call<{ channel?: { channelId?: string; mainThreadId?: string; name?: string; folderId?: string; recordId?: string } }>(ctx, "channels.get", { channelId: input.channelId });
  const ch = got.channel;
  if (!ch) raise(ctx, "validation.not_found", "That channel does not exist.");
  if (ch.recordId) raise(ctx, "validation.bad_input", "That channel already belongs to a record.", { reason: "channel_has_record" });
  const type = input.type ?? "project";
  await requireProjectType(ctx, type);
  const made = await makeProject(ctx, {
    type, title: (input.title ?? ch.name ?? "Project").trim() || "Project", stages: [], members: [], source: "channel", key: String(input.idempotencyKey),
    channel: { channelId: input.channelId, threadId: ch.mainThreadId, folderId: ch.folderId },
  });
  remember(ctx.db, input.idempotencyKey, "projects.from_channel", made);
  return made;
}

// ---- reads ----

export async function get(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const [fields, tasks] = await Promise.all([readRecord(ctx, p), tasksOrNone(ctx, p)]);
  return { project: projectRow(ctx, p, fields, tasks) };
}

export async function list(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const who = me(ctx);
  const mine = input.mine === true;
  const rows = allProjects(ctx.db).filter((p) =>
    (input.type === undefined || p.type === input.type)
    && (mine ? isMember(ctx.db, p.projectId, who) || p.createdBy === who : isMember(ctx.db, p.projectId, who) || p.createdBy === who || allows(ctx, "view", p.projectId)));
  // a status lives on the record, so a status filter reads the records first; without one only the page is read
  const out = async (ps: Project[]) => Promise.all(ps.map(async (p) => projectRow(ctx, p, await readRecord(ctx, p), await tasksOrNone(ctx, p))));
  if (input.status !== undefined) {
    const all = (await out(rows)).filter((r) => r.status === input.status);
    const pg = page(all, input.cursor, input.limit);
    return clean({ projects: pg.rows, next: pg.next, total: pg.total });
  }
  const pg = page(rows, input.cursor, input.limit);
  return clean({ projects: await out(pg.rows), next: pg.next, total: pg.total });
}

export async function overview(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "view");
  const [fields, tasks] = await Promise.all([readRecord(ctx, p), tasksOrNone(ctx, p)]);
  const plans = plansOf(ctx.db, p.projectId);
  const now = ctx.now();
  const all = tasks.map((t) => planTask(t, plans.get(t.taskId)));
  const open = all.filter((t) => t.status !== "done" && t.status !== "canceled");
  const dueAt = (t: { due?: number | undefined }): number => t.due ?? Number.MAX_SAFE_INTEGER;
  const stillOpen = new Set(open.map((t) => t.taskId));
  const waitsOn = new Map(tasks.map((t) => [t.taskId, t.dependsOn] as const));
  const milestones = open.filter((t) => t.milestone && dueAt(t) >= now).sort((a, b) => dueAt(a) - dueAt(b)).slice(0, 3);
  const late = open.filter((t) => t.due !== undefined && t.due < now).sort((a, b) => dueAt(a) - dueAt(b));
  const waiting = open.filter((t) => t.ring !== undefined || (waitsOn.get(t.taskId) ?? []).some((d) => stillOpen.has(d)));
  const u = updateOf(ctx.db, p.projectId);
  const threads: { threads?: Array<{ threadId: string; title?: string; createdAt?: number }> } = p.threadId ? await tolerant<{ threads?: Array<{ threadId: string; title?: string; createdAt?: number }> }>(ctx, "threads.list", { parentThreadId: p.threadId, limit: 5 }, {}) : {};
  return clean({
    project: projectRow(ctx, p, fields, tasks), goal: typeof fields["goal"] === "string" && fields["goal"] ? fields["goal"] : undefined,
    statusUpdate: u ? { text: u.text, at: u.at, by: u.by, drafted: u.drafted } : undefined,
    milestones, late, waiting, decisions: [], people: membersOf(ctx.db, p.projectId), linked: [], pinnedFiles: pinsOf(ctx.db, p.projectId),
    recentThreads: (threads.threads ?? []).map((t) => ({ threadId: t.threadId, title: t.title ?? "", at: t.createdAt ?? 0 })),
  });
}

export async function templatesList(ctx: ProjectsCtx, _input: In): Promise<unknown> {
  type FieldDef = { key?: string; options?: { stages?: Array<{ key?: string }> } };
  const described = await tolerant<{ types?: Array<{ key: string; title: string; template?: string; fields?: FieldDef[] }> }>(ctx, "schema.describe", {}, {});
  const builtin = (described.types ?? []).filter((t) => t.template === "project").map((t) => ({
    key: t.key, title: t.title, type: t.key, stages: ((t.fields ?? []).find((f) => f.key === "status")?.options?.stages ?? []).map((s) => String(s.key ?? "")).filter((k) => k !== ""), source: "builtin" as const,
  }));
  const starters = await tolerant<{ starters?: Array<{ templateId: string; title: string }> }>(ctx, "templates.project_starters", { kind: "project" }, {});
  const kit = (starters.starters ?? []).map((s) => ({ key: s.templateId, title: s.title, type: "project", stages: [] as string[], source: "kit" as const }));
  return { templates: [...builtin, ...kit] };
}

// ---- Overview upkeep ----

export async function postUpdate(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) raise(ctx, "validation.bad_input", "Write the update first.");
  const at = ctx.now();
  const drafted = ctx.principal.kind === "agent";
  saveUpdate(ctx.db, p.projectId, { text, at, by: me(ctx), drafted });
  await writeRecord(ctx, p, clean({ status_update: text, status_update_at: at, status: input.status }));
  if (p.threadId) {
    try { await call(ctx, "chat.post", { threadId: p.threadId, body: text }, { idempotencyKey: `prj-update:${p.projectId}:${at}:${text.length}` }); } catch (e) {
      ctx.log.warn("projects: the update was kept but not posted to the channel", { project: p.projectId, error: codeOf(e) });
    }
  }
  emitP(ctx, "project.update_posted", p.projectId, { by: me(ctx), drafted });
  return { postedAt: at };
}

export async function pinFile(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  await call(ctx, "files.get", { fileId: input.fileId });
  if (addPin(ctx.db, p.projectId, input.fileId, ctx.now())) {
    await writeRecord(ctx, p, { pinned_files: pinsOf(ctx.db, p.projectId) });
    emitP(ctx, "project.file_pinned", p.projectId, { fileId: input.fileId });
  }
  return { ok: true };
}

export async function unpinFile(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  if (!dropPin(ctx.db, p.projectId, input.fileId)) return { ok: false };
  await writeRecord(ctx, p, { pinned_files: pinsOf(ctx.db, p.projectId) });
  emitP(ctx, "project.file_unpinned", p.projectId, { fileId: input.fileId });
  return { ok: true };
}

export async function fileChat(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "edit");
  await call(ctx, "threads.get", { threadId: input.threadId });
  // the chat stays private; it gets the project's folder, and with it the project's memory and files
  if (p.folderId) await call(ctx, "threads.set_folder", { threadId: input.threadId, folderId: p.folderId });
  if (addFiled(ctx.db, p.projectId, input.threadId, ctx.now())) emitP(ctx, "project.chat_filed", p.projectId, { threadId: input.threadId });
  return { ok: true };
}

export async function shareOut(ctx: ProjectsCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const p = visible(ctx, input.projectId, "manage");
  if (input.expiresAt !== undefined && input.expiresAt <= ctx.now()) raise(ctx, "validation.bad_input", "The link must expire in the future.");
  const token = newId("shr", ctx.now()).slice(4);
  ctx.db.run("INSERT INTO projects_share (token, projectId, expiresAt, createdBy, createdAt) VALUES (?, ?, ?, ?, ?)", token, p.projectId, input.expiresAt ?? null, me(ctx), ctx.now());
  emitP(ctx, "project.shared_out", p.projectId, { expiresAt: input.expiresAt });
  return clean({ url: `/share/project/${token}`, expiresAt: input.expiresAt });
}
