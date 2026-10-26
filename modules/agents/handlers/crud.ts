// agents: the record, its lifecycle and its configuration (spec 2.6, 3.2, 4.5; ARCH 6.10, 7.2).
//   list / get / status / summary / visibility.set        what the person may see of the agents in the Space, and the agent page strip
//   create / update / role_line.set                        an agent is a record, one folder (Agents/<name>) and the files AGENT.md and agent.toml; every save of either goes through files.save
//   pause / resume / delete / restore                      the lifecycle; a delete moves the folder to Trash with it
//   config.get / config.validate / limits.get              what the next run will see, what a text would change, and the limits after the Space caps
//   snapshot.take / versions / restore_version             the files a run uses, and rolling back
// A broken agent.toml never stops an agent: the last good configuration stays in agents_agent.config and is what every read here returns.
import {
  AGENT_MD_DEFAULT, AWAKE_MS, LIMIT_KEYS, LIMIT_TOML, MAX_NAME, MAX_ROLE, NAME_BAD, TREE_FOLDERS, agentBy, agentByName, agentOf, agentOut, allAgents, allows, applyPatch, askerOf, call, canSee, checkToml,
  codeOf, ensure, insertAgent, makeFile, makeFolder, meta, mintId, newConfig, nameKey, parseToml, raise, saveFile, setMeta, slug, statusOf, storeConfig, textOf, tolerant, tomlFor, versionsOf, visible, widenings,
  writeConfig,
} from "../projections.ts";
import type { AgentConfig, AgentRec, AgentsCtx, FolderOut, Limits, VersionOut } from "../projections.ts";
import { readTemplate, templateVersion } from "./routines.ts";

type Row = Record<string, unknown>;
const by = (ctx: AgentsCtx): string => ctx.actingFor ?? ctx.principal.id;

// ---- reads ---------------------------------------------------------------------------------------------------------------------------------------------

export async function list(ctx: AgentsCtx, input: { section?: "personal" | "shared" | "space"; folderId?: string; status?: string[]; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const asker = askerOf(ctx);
  const now = ctx.now();
  const root = meta(ctx.db, "agents.root");
  let rows = allAgents(ctx.db).filter((a) => canSee(ctx, a));
  if (input.section === "personal") rows = rows.filter((a) => a.ownerId === asker);
  else if (input.section === "shared") rows = rows.filter((a) => a.ownerId !== asker);
  if (input.folderId !== undefined && input.folderId !== root) rows = rows.filter((a) => a.folderId === input.folderId);
  if (input.status && input.status.length > 0) rows = rows.filter((a) => input.status!.includes(statusOf(a, now)));
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const limit = input.limit ?? 100;
  const page = rows.slice(offset, offset + limit);
  return { agents: page.map((a) => agentOut(a, now)), ...(offset + limit < rows.length ? { next: String(offset + limit) } : {}), total: rows.length };
}

export async function get(ctx: AgentsCtx, input: { agentId: string }) {
  return { agent: agentOut(visible(ctx, input.agentId), ctx.now()) };
}

export async function status(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  const s = statusOf(a, ctx.now());
  const since = s === "paused" ? (a.pausedAt ?? a.updatedAt) : s === "asleep" ? (a.lastActiveAt !== undefined ? a.lastActiveAt + AWAKE_MS : a.createdAt) : (a.lastActiveAt ?? a.createdAt);
  return { status: s, since, ...(s === "paused" && a.pausedReason !== undefined ? { reason: a.pausedReason } : {}), ...(s === "paused" && a.pausedBy !== undefined ? { by: a.pausedBy } : {}) };
}

export async function summary(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  const now = ctx.now();
  const dayStart = now - (now % 86_400_000);
  const threads = await tolerant<{ threads?: Array<{ agents?: Array<{ agentId: string }>; createdAt: number }> }>(ctx, "threads.list", { kind: ["chat"], limit: 200 }, {});
  const tasks = await tolerant<{ tasks?: Array<{ id: string; title: string; state: string }> }>(ctx, "tasks.list", { scope: "all", assignee: { kind: "agent", id: a.id }, limit: 200 }, {});
  const runs = await tolerant<{ runs?: Array<{ id: string; name?: string; status: string }> }>(ctx, "runs.list", { scope: "subject", subject: { type: "agent", id: a.id }, since: dayStart, limit: 200 }, {});
  const spend = await tolerant<{ todayMicros?: number }>(ctx, "engine.spend.get", { scope: "agent", scopeId: a.id }, {});
  const facts = await tolerant<{ current?: number; proposed?: number }>(ctx, "memory.counts", { agentId: a.id }, {});
  const open = (tasks.tasks ?? []).filter((t) => t.state === "todo" || t.state === "doing" || t.state === "in_review" || t.state === "awaiting_approval");
  const active = (runs.runs ?? []).filter((r) => r.status === "running" || r.status === "queued" || r.status === "waiting");
  const mine = (ctx.db.all("SELECT channelId FROM agents_routine WHERE agentId = ? AND ownerId = ? AND channelId IS NOT NULL", a.id, askerOf(ctx)) as Row[]).map((r) => String(r["channelId"]));
  const limit = a.config.limits.dayCostMicros;
  return {
    chatsThisWeek: (threads.threads ?? []).filter((t) => t.createdAt >= now - 7 * 86_400_000 && (t.agents ?? []).some((x) => x.agentId === a.id)).length,
    openTasks: open.length,
    runsToday: (runs.runs ?? []).length,
    spendTodayMicros: spend.todayMicros ?? 0,
    ...(limit !== undefined ? { spendLimitMicros: limit } : {}),
    memoryFacts: facts.current ?? 0,
    proposedFacts: facts.proposed ?? 0,
    workingOn: [
      ...open.filter((t) => t.state === "doing").map((t) => ({ kind: "task", id: t.id, title: t.title })),
      ...active.map((r) => ({ kind: "run", id: r.id, title: r.name ?? "Run" })),
    ],
    linked: open.filter((t) => t.state !== "doing").map((t) => ({ kind: "task", id: t.id, title: t.title })),
    watches: [...new Set(mine)],
  };
}

export async function visibilitySet(ctx: AgentsCtx, input: { all: boolean }) {
  ensure(ctx.db);
  ctx.db.run(
    "INSERT INTO agents_visibility (principal, allAgents, at) VALUES (?, ?, ?) ON CONFLICT(principal) DO UPDATE SET allAgents = excluded.allAgents, at = excluded.at",
    askerOf(ctx), input.all ? 1 : 0, ctx.now(),
  );
  return { all: input.all };
}

// ---- create ----------------------------------------------------------------------------------------------------------------------------------------------

/** The Agents folder of the Space (the root key `agents` of the Files tree). */
async function agentsRoot(ctx: AgentsCtx): Promise<string> {
  const known = meta(ctx.db, "agents.root");
  if (known !== undefined) return known;
  const found = await call<{ folders?: FolderOut[] }>(ctx, "files.folder.search", { q: "Agents", scope: "folders", limit: 20 });
  const root = (found.folders ?? []).find((f) => f.name === "Agents" && f.parentId === undefined) ?? (found.folders ?? []).find((f) => f.path === "Agents");
  if (!root) raise(ctx, "internal.unexpected", "The Agents folder is missing from this Space.");
  setMeta(ctx.db, "agents.root", root.folderId);
  return root.folderId;
}

const LEVEL_RANK: Record<string, number> = { view: 0, use: 1, edit: 2, manage: 3 };

/**
 * Ruling 99: an agent holds Edit on its own Agents/<name> (not Manage, so it cannot share its home out) and its owner holds Manage there. This is applied ONCE per agent: when it is made, or the
 * first pass that sees an agent made before the ruling. A marker (agents.home_grants.v1:<agentId>) records that it was done, and an agent with the marker is never touched again, so a person who
 * lowers or removes one of these grants on purpose is not overruled by the boot pass. Within that one application a grant already held at the level or higher is left as it is. A failure writes no
 * marker, so the next pass tries again. Returns how many grants it wrote.
 */
export async function ensureHomeGrants(ctx: AgentsCtx, agentId: string, ownerId: string, folderId: string): Promise<number> {
  const marker = `agents.home_grants.v1:${agentId}`;
  if (meta(ctx.db, marker) !== undefined) return 0;
  const resource = { type: "folder", id: folderId };
  const have = await tolerant<{ shares?: Array<{ grant: { subject: { kind: string; id: string }; level: string } }> }>(ctx, "access.shares_of", { resource }, {});
  const holds = (kind: string, id: string, level: string): boolean =>
    (have.shares ?? []).some((x) => x.grant.subject.kind === kind && x.grant.subject.id === id && (LEVEL_RANK[x.grant.level] ?? -1) >= (LEVEL_RANK[level] ?? 99));
  let wrote = 0;
  if (!holds("agent", agentId, "edit")) {
    const idempotencyKey = `agent-home:${agentId}:agent`;
    await call(ctx, "access.share", { resource, subject: { kind: "agent", id: agentId }, level: "edit", source: `agent:${agentId}`, idempotencyKey }, { idempotencyKey });
    wrote += 1;
  }
  if (!holds("person", ownerId, "manage")) {
    const idempotencyKey = `agent-home:${agentId}:owner:${ownerId}`;
    await call(ctx, "access.share", { resource, subject: { kind: "person", id: ownerId }, level: "manage", source: `agent:${agentId}`, idempotencyKey }, { idempotencyKey });
    wrote += 1;
  }
  setMeta(ctx.db, marker, String(ctx.now()));
  return wrote;
}

export interface TreeResult { folderId: string; tomlFileId: string; agentMdFileId: string }

/** Agents/<name> with the decided tree, its two files, the Vyre guide and whatever the Agent template adds. */
async function createTree(ctx: AgentsCtx, agentId: string, name: string, tomlText: string, agentMd: string): Promise<TreeResult> {
  const root = await agentsRoot(ctx);
  // the home folder carries the agent as its subject (system_key agent:<id>): that is how Files knows AGENT.md and agent.toml in it are the agent's own
  const home = await makeFolder(ctx, root, name, `agents:${agentId}:folder`, { kind: "agent", id: agentId });
  const ids = new Map<string, string>([["", home.folderId]]);
  const template = await readTemplate(ctx);
  const folders = [...new Set([...TREE_FOLDERS, ...template.items.filter((i) => i.kind === "folder").map((i) => i.path)])]
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const path of folders) {
    const parts = path.split("/");
    const parent = ids.get(parts.slice(0, -1).join("/"));
    if (parent === undefined) continue;
    ids.set(path, (await makeFolder(ctx, parent, parts[parts.length - 1] as string, `agents:${agentId}:folder:${path}`)).folderId);
  }
  const toml = await makeFile(ctx, home.folderId, "agent.toml", tomlText, `agents:${agentId}:file:agent.toml`);
  const md = await makeFile(ctx, home.folderId, "AGENT.md", agentMd, `agents:${agentId}:file:AGENT.md`);
  for (const f of template.items.filter((i) => i.kind === "file" && i.path !== "AGENT.md" && i.path !== "agent.toml")) {
    const parts = f.path.split("/");
    const parent = ids.get(parts.slice(0, -1).join("/"));
    if (parent !== undefined) await makeFile(ctx, parent, parts[parts.length - 1] as string, f.text ?? "", `agents:${agentId}:file:${f.path}`);
  }
  return { folderId: home.folderId, tomlFileId: toml.fileId, agentMdFileId: md.fileId };
}

export async function create(ctx: AgentsCtx, input: {
  name: string; role?: string; face?: string; model?: string; ownerId?: string; computer?: boolean; templateKey?: string; tools?: { allowed: string[]; denied: string[] }; limits?: Limits; idempotencyKey?: string;
}) {
  ensure(ctx.db);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name === "" || name.length > MAX_NAME || NAME_BAD.test(name) || name.startsWith(".")) raise(ctx, "validation.bad_input", `An agent's name is up to ${MAX_NAME} characters with none of / \\ : * ? " < > | and no dot at the start.`);
  if (input.role !== undefined && (input.role.length > MAX_ROLE || input.role.includes("\n"))) raise(ctx, "validation.bad_input", `The role line is one line of up to ${MAX_ROLE} characters.`);
  if (agentByName(ctx.db, name)) raise(ctx, "validation.duplicate", "An agent with that name already exists.", { name });
  const owner = input.ownerId ?? askerOf(ctx);
  if (!owner.startsWith("usr_")) raise(ctx, "validation.bad_input", "An agent's owner is a person.", { ownerId: owner });
  // naming someone else as the owner hands them an agent and grants on its folder: that is for whoever manages access (owner and admin, permission access.manage), not for any member
  if (owner !== askerOf(ctx) && (!ctx.authorize || ctx.authorize({ perm: "access.manage", level: "manage" }, { type: "space", id: ctx.space }).effect !== "allow")) {   // no authorize means no answer: refuse
    raise(ctx, "permission.no_grant", "Only an owner or an admin can make someone else the owner of an agent.", { ownerId: owner });
  }
  if (input.limits) for (const [k, v] of Object.entries(input.limits)) if (!LIMIT_KEYS.includes(k as keyof Limits) || typeof v !== "number" || v < 0) raise(ctx, "validation.bad_input", `${k} is not a limit, or is not a number of zero or more.`);
  const config = newConfig({ name, role: input.role, model: input.model, tools: input.tools, limits: input.limits });
  const checked = checkToml(tomlFor(writeConfig({}, config)), { self: name });
  if (!checked.ok) raise(ctx, "validation.bad_input", checked.errors[0]?.message ?? "That configuration does not pass.");

  const now = ctx.now();
  const id = mintId("agt", now);
  const tomlText = tomlFor(writeConfig({}, config));
  const template = await readTemplate(ctx);
  const starter = template.items.find((i) => i.kind === "file" && i.path === "AGENT.md")?.text;
  const agentMd = starter !== undefined ? starter.replaceAll("{{name}}", name).replaceAll("{{role}}", input.role?.trim() ?? "") : AGENT_MD_DEFAULT(name, input.role);
  const tree = await createTree(ctx, id, name, tomlText, agentMd);
  // ruling 88: the owner manages the folder from the start, by a grant of their own whoever made it (the asker, when they are the owner, gets the same Manage share), so the owner can approve memory into the agent and edit its files
  {
    const idempotencyKey = `agent-owner:${id}:${owner}`;
    const grant = call(ctx, "access.share", { resource: { type: "folder", id: tree.folderId }, subject: { kind: "person", id: owner }, level: "manage", source: `agent-owner:${id}`, idempotencyKey }, { idempotencyKey });
    // someone else's agent must carry the grant or the call fails; for the asker's own agent the grant only makes explicit what making the folder already gave them
    if (owner !== askerOf(ctx)) await grant;
    else await grant.catch((e: unknown) => ctx.log.warn("agent folder grant for the owner was not made", { agentId: id, error: e instanceof Error ? e.message : String(e) }));
  }
  const rec: AgentRec = {
    id, name, face: input.face?.trim() || slug(name), ownerId: owner, folderId: tree.folderId, tomlFileId: tree.tomlFileId, agentMdFileId: tree.agentMdFileId, tomlText, config, hasComputer: input.computer === true,
    templateVersion: await templateVersion(ctx, template), paused: false, working: 0, lastActiveAt: now, createdAt: now, updatedAt: now,
  };
  insertAgent(ctx.db, rec);
  ctx.emit("agent.created", id, { agentId: id, name, ownerId: owner, folderId: tree.folderId, templateVersion: rec.templateVersion });
  return { agent: agentOut(rec, now) };
}

// ---- update ------------------------------------------------------------------------------------------------------------------------------------------------

/** Rename the folder with the agent. A name that is taken there is taken here too. */
async function renameFolder(ctx: AgentsCtx, a: AgentRec, name: string): Promise<void> {
  if (a.folderId === undefined) return;
  try { await call(ctx, "files.folder.rename", { folderId: a.folderId, name }); } catch (e) {
    if (codeOf(e) === "validation.duplicate") raise(ctx, "validation.bad_input", "A folder with that name already exists.", { name });
    throw e;
  }
}

async function saveToml(ctx: AgentsCtx, a: AgentRec, text: string, reason: string): Promise<{ versionId: string; n: number }> {
  if (a.tomlFileId === undefined) raise(ctx, "validation.bad_input", "This agent has no agent.toml yet.");
  return saveFile(ctx, a.tomlFileId, text, reason);
}

export async function update(ctx: AgentsCtx, input: { agentId: string; patch: Record<string, unknown> }) {
  const a = visible(ctx, input.agentId);
  if (!allows(ctx, null, "edit", "agent", a.id)) raise(ctx, "permission.no_grant", "You can read this agent but not change it.");
  const doc = parseToml(a.tomlText).value;
  const res = applyPatch(doc, a.config, input.patch);
  if (!res.ok) raise(ctx, res.code, res.message);
  if (res.fields.length === 0) return { agent: agentOut(a, ctx.now()) };
  const newName = res.config.name;
  if (nameKey(newName) !== nameKey(a.name) && agentByName(ctx.db, newName)) raise(ctx, "validation.bad_input", "An agent with that name already exists.", { name: newName });
  const text = tomlFor(res.doc);
  const checked = checkToml(text, { self: newName });
  if (!checked.ok) raise(ctx, "validation.bad_input", checked.errors[0]?.message ?? "That does not pass.");
  const fileFields = res.fields.filter((f) => f !== "face");
  let versionId: string | undefined;
  if (fileFields.length > 0 && text !== a.tomlText) {
    if (res.fields.includes("name")) await renameFolder(ctx, a, newName);
    versionId = (await saveToml(ctx, a, text, `Changed ${fileFields.join(", ")}`)).versionId;
  }
  const now = ctx.now();
  storeConfig(ctx.db, a.id, { name: newName, text, config: res.config, versionId, at: now });
  if (res.face !== undefined) ctx.db.run("UPDATE agents_agent SET face = ?, updatedAt = ? WHERE id = ?", res.face, now, a.id);
  ctx.emit("agent.config_changed", a.id, { agentId: a.id, fields: res.fields, ...(versionId !== undefined ? { versionId } : {}), by: by(ctx) });
  return { agent: agentOut(agentBy(ctx.db, a.id)!, now) };
}

export async function roleLineSet(ctx: AgentsCtx, input: { agentId: string; description: string }) {
  const a = visible(ctx, input.agentId);
  // Without Edit the role line is read-only (a lock on hover in the UI): the call is refused here the same way.
  if (!allows(ctx, null, "edit", "agent", a.id)) raise(ctx, "permission.no_grant", "You can read this agent but not change it.");
  const text = input.description.trim();
  if (text.includes("\n") || input.description.length > MAX_ROLE) raise(ctx, "validation.bad_input", `The role line is one line of up to ${MAX_ROLE} characters.`);
  if (a.tomlFileId === undefined) raise(ctx, "validation.bad_input", "This agent has no agent.toml yet.");
  // The version before the edit is what inline Undo restores.
  const before = await versionsOf(ctx, a.tomlFileId);
  const undo = [...before].sort((x, y) => y.n - x.n)[0];
  if (!undo) raise(ctx, "validation.bad_input", "agent.toml has no version to go back to.");
  if ((a.config.description ?? "") === text) return { agent: agentOut(a, ctx.now()), undoVersionId: undo.versionId };
  const res = applyPatch(parseToml(a.tomlText).value, a.config, { role: text });
  if (!res.ok) raise(ctx, res.code, res.message);
  const toml = tomlFor(res.doc);
  const saved = await saveToml(ctx, a, toml, "Changed the role line");
  storeConfig(ctx.db, a.id, { name: a.name, text: toml, config: res.config, versionId: saved.versionId, at: ctx.now() });
  ctx.emit("agent.config_changed", a.id, { agentId: a.id, fields: ["role"], versionId: saved.versionId, by: by(ctx) });
  return { agent: agentOut(agentBy(ctx.db, a.id)!, ctx.now()), undoVersionId: undo.versionId };
}

// ---- lifecycle -----------------------------------------------------------------------------------------------------------------------------------------------

export async function pause(ctx: AgentsCtx, input: { agentId: string; reason?: string }) {
  const a = visible(ctx, input.agentId);
  if (a.paused) return { agent: agentOut(a, ctx.now()) };
  const now = ctx.now();
  const reason = input.reason?.trim() || undefined;
  ctx.db.run("UPDATE agents_agent SET paused = 1, pausedReason = ?, pausedBy = ?, pausedAt = ?, updatedAt = ? WHERE id = ?", reason ?? null, by(ctx), now, now, a.id);
  ctx.emit("agent.paused", a.id, { agentId: a.id, ...(reason !== undefined ? { reason } : {}), by: by(ctx) });
  return { agent: agentOut(agentBy(ctx.db, a.id)!, now) };
}

export async function resume(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  if (!a.paused) return { agent: agentOut(a, ctx.now()) };
  const now = ctx.now();
  ctx.db.run("UPDATE agents_agent SET paused = 0, pausedReason = NULL, pausedBy = NULL, pausedAt = NULL, lastActiveAt = ?, updatedAt = ? WHERE id = ?", now, now, a.id);
  ctx.emit("agent.resumed", a.id, { agentId: a.id, by: by(ctx) });
  return { agent: agentOut(agentBy(ctx.db, a.id)!, now) };
}

export async function remove(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  const now = ctx.now();
  ctx.db.run("UPDATE agents_agent SET deletedAt = ?, updatedAt = ? WHERE id = ?", now, now, a.id);
  // The folder follows the Trash rules of Files; the agent's chats and memory stay where they are until the folder is emptied.
  if (a.folderId !== undefined) await tolerant(ctx, "files.folder.delete", { folderId: a.folderId }, null);
  ctx.emit("agent.deleted", a.id, { agentId: a.id, by: by(ctx) });
  return { deleted: true };
}

export async function restore(ctx: AgentsCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const a = agentBy(ctx.db, input.agentId, true);
  if (!a) raise(ctx, "validation.not_found", "That agent does not exist.");
  if (a.deletedAt === undefined) return { agent: agentOut(a, ctx.now()) };
  if (agentByName(ctx.db, a.name)) raise(ctx, "validation.bad_input", "Another agent has this name now. Rename that one first.", { name: a.name });
  const now = ctx.now();
  if (a.folderId !== undefined) await tolerant(ctx, "files.folder.restore", { folderId: a.folderId }, null);
  ctx.db.run("UPDATE agents_agent SET deletedAt = NULL, updatedAt = ? WHERE id = ?", now, a.id);
  ctx.emit("agent.restored", a.id, { agentId: a.id, by: by(ctx) });
  return { agent: agentOut(agentBy(ctx.db, a.id)!, now) };
}

// ---- configuration -------------------------------------------------------------------------------------------------------------------------------------------

const lineCount = (t: string): number => (t === "" ? 0 : t.endsWith("\n") ? t.split("\n").length - 1 : t.split("\n").length);

/** The newest agent.toml, judged: valid becomes the effective configuration, invalid is reported and the last good one stays. */
export async function currentToml(ctx: AgentsCtx, a: AgentRec): Promise<{ config: AgentConfig; error?: { line?: number; message: string }; text: string }> {
  if (a.tomlFileId === undefined) return { config: a.config, text: a.tomlText };
  let text: string;
  try { text = await textOf(ctx, a.tomlFileId); } catch { return { config: a.config, text: a.tomlText, ...(a.configError ? { error: a.configError } : {}) }; }
  if (text === a.tomlText) return { config: a.config, text, ...(a.configError ? { error: a.configError } : {}) };
  const names = (await tolerant<{ agents?: Array<{ name: string }> }>(ctx, "agents.list", {}, {})).agents?.map((x) => x.name);
  const checked = checkToml(text, { ...(names ? { agentNames: names } : {}), self: a.name });
  if (checked.ok && checked.config) return { config: checked.config, text };
  const first = checked.errors[0];
  return { config: a.config, text: a.tomlText, error: first ?? { message: "agent.toml does not pass." } };
}

export async function configGet(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  const cur = await currentToml(ctx, a);
  const readText = async (fileId: string | undefined): Promise<string> => (fileId === undefined ? "" : String((await tolerant<{ text?: string }>(ctx, "files.read", { fileId, as: "text" }, {})).text ?? ""));
  const space = await tolerant<{ files?: Array<{ fileId: string; name: string }> }>(ctx, "files.list", { section: "space", limit: 200 }, {});
  const vyre = (space.files ?? []).find((f) => f.name === "VYRE.md");
  return {
    effective: cur.config as unknown as Record<string, unknown>,
    ...(a.lastGoodVersionId !== undefined ? { lastGoodVersionId: a.lastGoodVersionId } : {}),
    ...(cur.error ? { error: { ...(cur.error.line !== undefined ? { line: cur.error.line } : {}), message: cur.error.message } } : {}),
    lines: { agentMd: lineCount(await readText(a.agentMdFileId)), vyreMd: lineCount(await readText(vyre?.fileId)) },
  };
}

export async function configValidate(ctx: AgentsCtx, input: { agentId: string; toml: string }) {
  const a = visible(ctx, input.agentId);
  const names = (await tolerant<{ agents?: Array<{ name: string }> }>(ctx, "agents.list", {}, {})).agents?.map((x) => x.name);
  const checked = checkToml(input.toml, { ...(names ? { agentNames: names } : {}), self: a.name });
  return {
    ok: checked.ok,
    errors: [...checked.errors, ...checked.warnings].map((p) => ({ ...(p.line !== undefined ? { line: p.line } : {}), message: p.message })),
    widens: checked.ok && checked.config ? widenings(a.config, checked.config) : [],
  };
}

export async function limitsGet(ctx: AgentsCtx, input: { agentId: string }) {
  const a = visible(ctx, input.agentId);
  const caps = async (scope: "space" | "person", scopeId?: string) => (await tolerant<{ caps?: { run?: number; dayMicros?: number; monthMicros?: number; turnsPerDay?: number; timeMinutesPerRun?: number } }>(ctx, "engine.spend.get", { scope, ...(scopeId ? { scopeId } : {}) }, {})).caps ?? {};
  const space = await caps("space"), person = await caps("person", a.ownerId);
  const capFor = (c: typeof space, k: keyof Limits): number | undefined =>
    ({ runCostMicros: c.run, dayCostMicros: c.dayMicros, monthCostMicros: c.monthMicros, turnsPerDay: c.turnsPerDay, minutesPerRun: c.timeMinutesPerRun, tokensPerDay: undefined } as Record<keyof Limits, number | undefined>)[k];
  const limits: Limits = {};
  const source: Record<string, "agent" | "person" | "space"> = {};
  for (const k of LIMIT_KEYS) {
    const candidates: Array<[number, "agent" | "person" | "space"]> = [];
    const own = a.config.limits[k]; if (own !== undefined) candidates.push([own, "agent"]);
    const p = capFor(person, k); if (p !== undefined) candidates.push([p, "person"]);
    const s = capFor(space, k); if (s !== undefined) candidates.push([s, "space"]);
    if (candidates.length === 0) continue;
    // agent.toml can never exceed a cap: the smallest wins, and the answer says whose it is
    const [v, who] = candidates.reduce((m, c) => (c[0] < m[0] ? c : m));
    limits[k] = v;
    source[LIMIT_TOML[k]] = who;
  }
  return { limits, source };
}

export async function snapshotTake(ctx: AgentsCtx, input: { agentId: string; runId?: string }) {
  const a = visible(ctx, input.agentId);
  if (input.runId !== undefined) {
    const same = (ctx.db.all("SELECT id, version FROM agents_snapshot WHERE agentId = ? AND runId = ?", a.id, input.runId) as Row[])[0];
    if (same) return { snapshotId: String(same["id"]), version: Number(same["version"]) };
  }
  const newest = async (fileId: string | undefined): Promise<string | undefined> => {
    if (fileId === undefined) return undefined;
    try { return [...(await versionsOf(ctx, fileId))].sort((x, y) => y.n - x.n)[0]?.versionId; } catch { return undefined; }
  };
  const tomlV = await newest(a.tomlFileId), mdV = await newest(a.agentMdFileId);
  const last = (ctx.db.all("SELECT * FROM agents_snapshot WHERE agentId = ? ORDER BY version DESC LIMIT 1", a.id) as Row[])[0];
  // Nothing changed since the last snapshot and no run asked for its own: the same snapshot serves.
  if (last && input.runId === undefined && (last["tomlVersionId"] ?? null) === (tomlV ?? null) && (last["agentMdVersionId"] ?? null) === (mdV ?? null) && String(last["config"]) === JSON.stringify(a.config)) {
    return { snapshotId: String(last["id"]), version: Number(last["version"]) };
  }
  const version = last ? Number(last["version"]) + 1 : 1;
  const id = mintId("snp", ctx.now());
  ctx.db.run(
    "INSERT INTO agents_snapshot (id, agentId, version, runId, tomlVersionId, agentMdVersionId, config, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, a.id, version, input.runId ?? null, tomlV ?? null, mdV ?? null, JSON.stringify(a.config), ctx.now(),
  );
  return { snapshotId: id, version };
}

type AgentFile = "AGENT.md" | "agent.toml";
export async function versions(ctx: AgentsCtx, input: { agentId: string; file?: AgentFile }) {
  const a = visible(ctx, input.agentId);
  const files: Array<[AgentFile, string | undefined]> = [["agent.toml", a.tomlFileId], ["AGENT.md", a.agentMdFileId]];
  const out: VersionOut[] = [];
  for (const [name, id] of files) {
    if (id === undefined || (input.file !== undefined && input.file !== name)) continue;
    out.push(...(await versionsOf(ctx, id)));
  }
  return { versions: out.sort((x, y) => y.at - x.at || y.n - x.n).map((v) => ({ versionId: v.versionId, n: v.n, by: v.by, at: v.at, ...(v.reason !== undefined ? { reason: v.reason } : {}), ...(v.name !== undefined ? { name: v.name } : {}) })) };
}

export async function restoreVersion(ctx: AgentsCtx, input: { agentId: string; versionId: string; file?: AgentFile }) {
  const a = visible(ctx, input.agentId);
  if (!allows(ctx, null, "edit", "agent", a.id)) raise(ctx, "permission.no_grant", "You can read this agent but not change it.");
  const candidates: Array<[AgentFile, string]> = [];
  if (a.tomlFileId !== undefined && (input.file === undefined || input.file === "agent.toml")) candidates.push(["agent.toml", a.tomlFileId]);
  if (a.agentMdFileId !== undefined && (input.file === undefined || input.file === "AGENT.md")) candidates.push(["AGENT.md", a.agentMdFileId]);
  let target: [AgentFile, string] | undefined;
  for (const c of candidates) if ((await versionsOf(ctx, c[1])).some((v) => v.versionId === input.versionId)) { target = c; break; }
  if (!target) raise(ctx, "validation.not_found", "That version is not one of this agent's files.");
  const [file, fileId] = target;
  let nextConfig: AgentConfig | undefined, nextText: string | undefined;
  if (file === "agent.toml") {
    // An old version that would not pass today is not brought back: the last good configuration keeps running.
    nextText = await textOf(ctx, fileId, input.versionId);
    const checked = checkToml(nextText, { self: a.name });
    if (!checked.ok || !checked.config) raise(ctx, "validation.bad_input", `That version of agent.toml does not pass: ${checked.errors[0]?.message ?? "it has an error"}`);
    nextConfig = checked.config;
  }
  let restoredId: string;
  try { restoredId = (await call<{ versionId: string }>(ctx, "files.restore_version", { fileId, versionId: input.versionId })).versionId; } catch (e) {
    if (codeOf(e) === "validation.not_found") raise(ctx, "validation.not_found", "That version does not exist.");
    throw e;
  }
  const now = ctx.now();
  const fields = nextConfig ? changedFields(a.config, nextConfig) : ["AGENT.md"];
  if (nextConfig && nextText !== undefined) storeConfig(ctx.db, a.id, { name: nextConfig.name, text: nextText, config: nextConfig, versionId: restoredId, at: now });
  ctx.emit("agent.config_changed", a.id, { agentId: a.id, fields, versionId: restoredId, by: by(ctx) });
  return { agent: agentOut(agentBy(ctx.db, a.id)!, now) };
}

/** Which fields differ between two configurations, by the names agents.update uses. */
export function changedFields(a: AgentConfig, b: AgentConfig): string[] {
  const out: string[] = [];
  const diff = (k: string, x: unknown, y: unknown): void => { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(k); };
  diff("name", a.name, b.name); diff("role", a.description, b.description); diff("model", a.model, b.model); diff("fallbackModel", a.fallbackModel, b.fallbackModel);
  diff("accountPolicy", a.accountPolicy, b.accountPolicy); diff("accountKey", a.accountKey, b.accountKey); diff("handoffs", a.handoffs, b.handoffs);
  diff("toolsAllowed", a.toolsAllowed, b.toolsAllowed); diff("toolsDenied", a.toolsDenied, b.toolsDenied); diff("vaultKeys", a.vaultKeys, b.vaultKeys);
  diff("limits", a.limits, b.limits); diff("captureMode", a.captureMode, b.captureMode);
  return out.length > 0 ? out : ["agent.toml"];
}

// ---- what the engine and Files tell this module --------------------------------------------------------------------------------------------------------

export interface FileVersionEvent { payload: { fileId: string; versionId: string; n?: number; by?: string } }
export interface TurnEvent { payload: { agentId: string } }

/**
 * A person saved agent.toml or AGENT.md in Files. A text that passes becomes the configuration the next run uses; one that does not is reported (agent.config_error) and the last good
 * version keeps running. Returns the agents it concerned. Safe to run twice for one event.
 */
export async function onFileVersion(ctx: AgentsCtx, event: FileVersionEvent): Promise<string[]> {
  ensure(ctx.db);
  const { fileId, versionId } = event.payload;
  const row = (ctx.db.all("SELECT * FROM agents_agent WHERE (tomlFileId = ? OR agentMdFileId = ?) AND deletedAt IS NULL", fileId, fileId) as Row[])[0];
  if (!row) return [];
  const a = agentOf(row);
  const who = event.payload.by ?? "unknown";
  if (a.agentMdFileId === fileId) {
    ctx.emit("agent.config_changed", a.id, { agentId: a.id, fields: ["AGENT.md"], versionId, by: who });
    return [a.id];
  }
  const text = await textOf(ctx, fileId, versionId);
  if (text === a.tomlText) return [a.id];
  const checked = checkToml(text, { self: a.name });
  if (!checked.ok || !checked.config) {
    const first = checked.errors[0] ?? { message: "agent.toml does not pass." };
    ctx.db.run("UPDATE agents_agent SET configError = ?, updatedAt = ? WHERE id = ?", JSON.stringify(first), ctx.now(), a.id);
    ctx.emit("agent.config_error", a.id, { agentId: a.id, message: first.message, ...(first.line !== undefined ? { line: first.line } : {}) });
    return [a.id];
  }
  const fields = changedFields(a.config, checked.config);
  storeConfig(ctx.db, a.id, { name: checked.config.name, text, config: checked.config, versionId, at: ctx.now() });
  ctx.emit("agent.config_changed", a.id, { agentId: a.id, fields, versionId, by: who });
  return [a.id];
}

/** The engine's turns keep the status honest: Working while a turn runs, Awake for two minutes after the last one. */
export function onTurn(ctx: AgentsCtx, kind: "started" | "ended", event: TurnEvent): void {
  ensure(ctx.db);
  const now = ctx.now();
  if (kind === "started") ctx.db.run("UPDATE agents_agent SET working = working + 1, lastActiveAt = ? WHERE id = ?", now, event.payload.agentId);
  else ctx.db.run("UPDATE agents_agent SET working = CASE WHEN working > 0 THEN working - 1 ELSE 0 END, lastActiveAt = ? WHERE id = ?", now, event.payload.agentId);
}


// ---- the boot check ------------------------------------------------------------------------------------------------------------------------------------------

interface FileGot { file?: { fileId: string; folderId: string; name: string; deletedAt?: number } }

/**
 * An agent folder is never without its two files. For every live agent, AGENT.md and agent.toml must be in Agents/<name> under those names; a missing one is put back from the agent record:
 * one in Trash is restored, one that was moved or renamed is moved back, one that is gone is made again (agent.toml from the last good text the record keeps, AGENT.md from the name and role line).
 * Files itself refuses to delete, move or rename them (files.* guard); this catches what happened before the guard or underneath it. Answers what it put back, as "<agent>/<file>".
 */
export async function restoreAgentFiles(ctx: AgentsCtx): Promise<string[]> {
  ensure(ctx.db);
  const put: string[] = [];
  await adoptAgentPrincipals(ctx, put);
  for (let a of allAgents(ctx.db)) {
    if (a.folderId === undefined) {
      // a record with no home: make Agents/<name> with the decided tree and both files, and point the record at them
      try {
        const tree = await createTree(ctx, a.id, a.name, a.tomlText, AGENT_MD_DEFAULT(a.name, a.config.description));
        ctx.db.run("UPDATE agents_agent SET folderId = ?, tomlFileId = ?, agentMdFileId = ?, updatedAt = ? WHERE id = ?", tree.folderId, tree.tomlFileId, tree.agentMdFileId, ctx.now(), a.id);
        put.push(`${a.name}/agent.toml`, `${a.name}/AGENT.md`);
        ctx.log.warn("agents: an agent had no folder and has been given one", { agent: a.id });
        a = { ...a, folderId: tree.folderId, tomlFileId: tree.tomlFileId, agentMdFileId: tree.agentMdFileId };
      } catch (e) {
        ctx.log.warn("agents: an agent without a folder could not be given one", { agent: a.id, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
        continue;
      }
    }
    if (a.folderId === undefined) continue;
    const folderId = a.folderId;
    try {
      if ((await ensureHomeGrants(ctx, a.id, a.ownerId, folderId)) > 0) put.push(`${a.name}/grants`);
    } catch (e) {
      ctx.log.warn("agents: the grants on an agent's folder could not be written", { agent: a.id, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
    const wanted: Array<{ name: "agent.toml" | "AGENT.md"; id: string | undefined; column: "tomlFileId" | "agentMdFileId"; text: () => string }> = [
      { name: "agent.toml", id: a.tomlFileId, column: "tomlFileId", text: () => a.tomlText },
      { name: "AGENT.md", id: a.agentMdFileId, column: "agentMdFileId", text: () => AGENT_MD_DEFAULT(a.name, a.config.description) },
    ];
    for (const w of wanted) {
      try {
        const got = w.id === undefined ? null : await tolerant<FileGot | null>(ctx, "files.get", { fileId: w.id }, null);
        const f = got?.file;
        if (f && f.deletedAt === undefined && f.folderId === folderId && f.name === w.name) continue;
        let id = w.id;
        if (f && f.deletedAt !== undefined) await call(ctx, "files.restore", { fileId: f.fileId, toFolderId: folderId });
        else if (f) await call(ctx, "files.move", { fileId: f.fileId, toFolderId: folderId, name: w.name });
        else {
          const made = await makeFile(ctx, folderId, w.name, w.text(), `agents:${a.id}:restore:${w.name}:${ctx.now()}`);
          id = made.fileId;
          ctx.db.run(`UPDATE agents_agent SET ${w.column} = ?, updatedAt = ? WHERE id = ?`, id, ctx.now(), a.id);
        }
        put.push(`${a.name}/${w.name}`);
        ctx.log.warn("agents: an agent file was missing and has been put back", { agent: a.id, file: w.name });
      } catch (e) {
        ctx.log.warn("agents: an agent file could not be put back", { agent: a.id, file: w.name, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
      }
    }
  }
  return put;
}

/**
 * An agent of the Space (a principal of kind agent) that access knows but this module has no record for, such as one the seed wrote straight to the log, gets its record, its Agents/<name> folder with
 * the decided tree and both files. Its name and owner come from the principal. An owner that is not a person, or a name another agent already has, leaves it alone and says so in the log.
 * Outside agents are kind actor, not agent, and are never adopted.
 */
async function adoptAgentPrincipals(ctx: AgentsCtx, put: string[]): Promise<void> {
  const listed = await tolerant<{ principals?: Array<{ id: string; kind: string; name: string; owner?: string; status: string }> }>(ctx, "access.principals.list", { kind: "agent", limit: 200 }, {});
  for (const p of listed.principals ?? []) {
    // Only the Space's own agents (kind agent, id agt_...). An outside agent (Claude Code, Codex over MCP) registers as an outside actor (kind actor) and never gets a Vyre agent record or home;
    // the kind is checked here as well as in the query so a list that ignored the filter could not adopt one.
    if (p.kind !== "agent" || !p.id.startsWith("agt_")) continue;
    if (p.status === "removed" || agentBy(ctx.db, p.id)) continue;
    const name = p.name.trim();
    const owner = p.owner;
    if (name === "" || agentByName(ctx.db, name) || owner === undefined || !owner.startsWith("usr_")) {
      ctx.log.warn("agents: an agent principal has no record and could not be adopted", { agent: p.id });
      continue;
    }
    try {
      const config = newConfig({ name });
      const tomlText = tomlFor(writeConfig({}, config));
      const tree = await createTree(ctx, p.id, name, tomlText, AGENT_MD_DEFAULT(name, undefined));
      const now = ctx.now();
      insertAgent(ctx.db, {
        id: p.id, name, face: slug(name), ownerId: owner, folderId: tree.folderId, tomlFileId: tree.tomlFileId, agentMdFileId: tree.agentMdFileId, tomlText, config, hasComputer: false,
        templateVersion: await templateVersion(ctx), paused: false, working: 0, lastActiveAt: now, createdAt: now, updatedAt: now,
      });
      await ensureHomeGrants(ctx, p.id, owner, tree.folderId);
      put.push(`${name}/agent.toml`, `${name}/AGENT.md`);
      ctx.log.warn("agents: an agent principal had no record, folder or files and has been given them", { agent: p.id });
    } catch (e) {
      ctx.log.warn("agents: an agent principal could not be adopted", { agent: p.id, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
}
