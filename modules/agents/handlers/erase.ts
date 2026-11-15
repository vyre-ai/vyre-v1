// Delete an agent for good (F77, lead rulings 15 Nov 2026). Delete moves an agent to Trash and stays whole both ways; this is the other half: from Trash, by whoever manages the agent, or by the Space's own
// Trash clock, every store that holds something of the agent is cleared by one durable, resumable, idempotent job.
// DECISION: the job is a list of steps, one per module that keeps something of an agent, each a host call `<module>.erase_agent` (the module clears its own tables; modules never read each other's). The progress is
// a row in agents_erase, written after each step, so a daemon killed half way finds its place again; a step is safe to run again, so is the whole job. It runs as the server (a periodic pass), never as the
// person who pressed, because the person may not hold the permissions of every store (only whoever manages the agent may press it). The press only writes the row and says "Deleting".
// DECISION: what stays, on purpose: the audit log, this row as the tombstone (id, name at the time, who, when), and backups made before.
// DECISION: a person's Assistant is refused here in one sentence; it goes only with its person (agents.person_left) and, when Trash has kept it as long as Trash keeps things, by the same job.
import { agentBy, agentOf, allows, canSee, ensure, raise, tolerant } from "../projections.ts";
import type { AgentRec, AgentsCtx } from "../projections.ts";
import { eraseWhere, tryRun } from "../../../lib/erase-agent.ts";
export { eraseWhere };
import type { Footprint } from "../../../lib/erase-agent.ts";
export type { Footprint };

type Row = Record<string, unknown>;

/** The modules that keep something of an agent, in the order they are cleared: the agent's own folder and row go last, so a restart half way can still read what to clear. */
export const ERASE_STEPS = [
  "engine",
  "gate",
  "mcp",
  "scheduler-api",
  "hooks",
  "automations",
  "tasks",
  "goals",
  "projects",
  "notifications",
  "memory",
  "chat",
  "computers",
  "terminal",
  "machines",
  "access",
  "vault",
  "search",
  "files",
] as const;
export const ERASE_JOB = "host.hook.periodic.agents.erase_job";
const stepCall = (module: string): string => `host.hook.call.${module}.erase_agent`;

const code = (e: unknown): string =>
  (e as { error?: { code?: string } } | null)?.error?.code ?? (e as { code?: string } | null)?.code ?? "";
/** A module that is not in this Space (a Personal Space has fewer), or has nothing to say: that step is done. */
const absent = (e: unknown): boolean =>
  code(e) === "validation.unknown_capability" ||
  code(e) === "validation.not_found" ||
  code(e) === "permission.not_found";

const pending = (ctx: AgentsCtx, id: string): Row | undefined =>
  (ctx.db.all("SELECT * FROM agents_erase WHERE agentId = ?", id) as Row[])[0];

/** Has this agent been erased (or is it being)? Its id is never reused. */
export function erasedRow(ctx: Pick<AgentsCtx, "db">, id: string): { state: string; name: string } | undefined {
  try {
    const r = (ctx.db.all("SELECT state, name FROM agents_erase WHERE agentId = ?", id) as Row[])[0];
    return r ? { state: String(r["state"]), name: String(r["name"]) } : undefined;
  } catch {
    return undefined;
  }
}

export function refuseKind(ctx: AgentsCtx, a: AgentRec): void {
  if (a.kind === "assistant")
    raise(ctx, "validation.precondition_failed", "A person's Assistant stays with them and cannot be deleted.", {
      reason: "assistant_stays",
    });
}

/** Press "Delete for good" on an agent in Trash: the job is recorded and starts at once; the answer is that it is deleting. Pressing again changes nothing. */
export async function deleteForGood(ctx: AgentsCtx, input: { agentId: string }): Promise<{ erasing: boolean }> {
  ensure(ctx.db);
  const have = pending(ctx, input.agentId);
  if (have) return { erasing: String(have["state"]) === "erasing" };
  const a = agentBy(ctx.db, input.agentId, true);
  if (!a) raise(ctx, "validation.not_found", "That agent does not exist.");
  if (ctx.principal.kind === "agent" && ctx.principal.id === a.id)
    raise(ctx, "validation.precondition_failed", "An agent cannot delete itself for good.", { reason: "self" });
  refuseKind(ctx, a);
  if (a.deletedAt === undefined)
    raise(ctx, "validation.precondition_failed", "Move the agent to Trash first, then delete it for good.", {
      reason: "not_in_trash",
    });
  start(ctx, a, ctx.actingFor ?? ctx.principal.id);
  return { erasing: true };
}

function start(ctx: AgentsCtx, a: AgentRec, by: string): void {
  const now = ctx.now();
  ctx.db.run(
    `INSERT INTO agents_erase ("agentId", "name", "ownerId", "kind", "folderId", "requestedBy", "requestedAt", "state", "doneJson", "tries")
     VALUES (?, ?, ?, ?, ?, ?, ?, 'erasing', '[]', 0) ON CONFLICT ("agentId") DO NOTHING`,
    a.id,
    a.name,
    a.ownerId,
    a.kind,
    a.folderId ?? null,
    by,
    now,
  );
  ctx.emit("agent.erasing", a.id, { agentId: a.id, name: a.name, by });
}

/** What deleting this agent for good would remove and what would need someone, as real counts from the stores themselves (each module answers its own, without changing anything). */
export async function deletePreview(ctx: AgentsCtx, input: { agentId: string }) {
  ensure(ctx.db);
  const a = agentBy(ctx.db, input.agentId, true);
  if (!a) raise(ctx, "validation.not_found", "That agent does not exist.");
  const out = {
    chats: 0,
    sharedChats: 0,
    memory: 0,
    bytes: 0,
    routines: 0,
    named: [] as NonNullable<Footprint["named"]>,
  };
  for (const m of ERASE_STEPS) {
    const f = await tolerant<Footprint>(
      ctx,
      stepCall(m),
      { input: { agentId: a.id, name: a.name, folderId: a.folderId, dry: true } },
      {},
    );
    out.chats += f.chats ?? 0;
    out.sharedChats += f.sharedChats ?? 0;
    out.memory += f.memory ?? 0;
    out.bytes += f.bytes ?? 0;
    out.routines += f.routines ?? 0;
    out.named.push(...(f.named ?? []));
  }
  const routines = (ctx.db.all("SELECT COUNT(*) AS n FROM agents_routine WHERE agentId = ?", a.id) as Row[])[0];
  out.routines += Number(routines?.["n"] ?? 0);
  const holdsBackups = true;
  return {
    agentId: a.id,
    name: a.name,
    kind: a.kind,
    inTrash: a.deletedAt !== undefined,
    ...out,
    backups: holdsBackups ? "Backups made before today still hold a copy until they are rotated out." : "",
    refused: a.kind === "assistant" ? "A person's Assistant stays with them and cannot be deleted." : undefined,
  };
}

/** The agents in Trash, newest first, with what is happening to them: Deleting while the job runs. Whoever may see an agent sees it here; only one who manages it may delete it for good. */
export async function trashList(ctx: AgentsCtx) {
  ensure(ctx.db);
  const rows = ctx.db.all(
    `SELECT * FROM agents_agent WHERE deletedAt IS NOT NULL AND kind <> 'teammate' ORDER BY deletedAt DESC, id`,
  ) as Row[];
  const asker = ctx.actingFor ?? ctx.principal.id;
  const out: Array<{
    agentId: string;
    name: string;
    kind: string;
    ownerId: string;
    deletedAt: number;
    deleting: boolean;
    canDelete: boolean;
  }> = [];
  for (const r of rows) {
    const a = agentOf(r);
    if (!canSee(ctx, a)) continue;
    out.push({
      agentId: a.id,
      name: a.name,
      kind: a.kind,
      ownerId: a.ownerId,
      deletedAt: a.deletedAt ?? 0,
      deleting: String(pending(ctx, a.id)?.["state"]) === "erasing",
      canDelete: a.kind !== "assistant" && (a.ownerId === asker || mayManage(ctx, a)),
    });
  }
  return { agents: out };
}

const mayManage = (ctx: AgentsCtx, a: AgentRec): boolean => {
  void a;
  return ctx.authorize !== undefined && allows(ctx, "access.manage", "manage", "space", ctx.space);
};

const doneOf = (r: Row): string[] => {
  try {
    return JSON.parse(String(r["doneJson"])) as string[];
  } catch {
    return [];
  }
};

/** One pass of the job over every agent being erased. Each step is saved when it finishes; one that fails is tried again on the next pass, and the ones after it wait. */
export async function runErase(ctx: AgentsCtx): Promise<string[]> {
  ensure(ctx.db);
  const jobs = ctx.db.all(
    "SELECT * FROM agents_erase WHERE state = 'erasing' ORDER BY requestedAt, agentId LIMIT 5",
  ) as Row[];
  const finished: string[] = [];
  for (const j of jobs) {
    const id = String(j["agentId"]);
    const done = new Set(doneOf(j));
    let stuck = false;
    for (const m of ERASE_STEPS) {
      if (done.has(m)) continue;
      try {
        await ctx.call?.(stepCall(m), {
          input: { agentId: id, name: String(j["name"]), folderId: j["folderId"] ?? undefined, dry: false },
        });
      } catch (e) {
        if (!absent(e)) {
          ctx.db.run(
            `UPDATE agents_erase SET "tries" = "tries" + 1, "lastError" = ? WHERE "agentId" = ?`,
            `${m}: ${e instanceof Error ? e.message.slice(0, 200) : code(e) || "error"}`,
            id,
          );
          ctx.log.warn("agents: a store could not be cleared for a deleted agent, the job tries again", {
            agentId: id,
            step: m,
          });
          stuck = true;
          break;
        }
      }
      done.add(m);
      ctx.db.run(`UPDATE agents_erase SET "doneJson" = ? WHERE "agentId" = ?`, JSON.stringify([...done]), id);
    }
    if (stuck) continue;
    eraseOwn(ctx, id);
    ctx.db.run(
      `UPDATE agents_erase SET "state" = 'erased', "finishedAt" = ?, "lastError" = NULL WHERE "agentId" = ?`,
      ctx.now(),
      id,
    );
    ctx.emit("agent.erased", id, { agentId: id, name: String(j["name"]) });
    finished.push(id);
  }
  return finished;
}

/** The agent's own tables: its row and profile, every version, its routines and what hangs on them, its skills, plugins and connections, its outside jobs. Safe to run again. */
export function eraseOwn(ctx: Pick<AgentsCtx, "db">, id: string): void {
  const db = ctx.db;
  for (const t of [
    "agents_routine_watch",
    "agents_routine_by",
    "agents_routine_last",
    "agents_routine_wake",
    "agents_routine_delegation",
  ])
    tryRun(db, `DELETE FROM ${t} WHERE "routineId" IN (SELECT id FROM agents_routine WHERE agentId = ?)`, id);
  eraseWhere(db, id, [
    ["agents_routine", "agentId"],
    ["agents_suggestion", "agentId"],
    ["agents_snapshot", "agentId"],
    ["agents_skills", "agent_id"],
    ["agents_plugins", "agent_id"],
    ["agents_mcp_connections", "agent_id"],
    ["agents_outside_jobs", "agentId"],
    ["agents_skill_grants", "agent_id"],
    ["agents_install", "agent_id"],
    ["agents_agent", "id"],
  ]);
  tryRun(db, "DELETE FROM agents_meta WHERE key = ?", `assistant:${id}`);
}

// ---- the Trash clock ---------------------------------------------------------------------------------------------------------------------------------

/** How long Trash keeps an agent when the Space's own setting cannot be read: governance's default for trash (manifests/governance.ts '30d'; test/trash-retention.test.ts holds them together). */
export const TRASH_KEEP_MS = 30 * 86_400_000;

/** A retention value as governance writes it ("30d", "12w", "6m", "2y", "forever") in ms; null for forever; undefined when it is none of those. */
export function retentionMs(v: string): number | null | undefined {
  if (v === "forever") return null;
  const m = /^(\d{1,5})([dwmy])$/.exec(v.trim());
  if (!m) return undefined;
  return Number(m[1]) * { d: 1, w: 7, m: 30, y: 365 }[m[2] as "d" | "w" | "m" | "y"] * 86_400_000;
}

/** The Space's Trash keep time, the one the Files Trash runs on (governance's `trash` retention); null when Trash is kept forever. */
export async function trashKeepMs(ctx: AgentsCtx): Promise<number | null> {
  try {
    const out = (await ctx.call?.("governance.retention.get", {})) as {
      kinds?: Array<{ key?: string; value?: string }>;
    };
    const v = out?.kinds?.find((k) => k.key === "trash")?.value;
    const ms = typeof v === "string" ? retentionMs(v) : undefined;
    if (ms !== undefined) return ms;
  } catch {
    /* governance is not in this Space: the default */
  }
  return TRASH_KEEP_MS;
}

/** An agent that has been in Trash as long as Trash keeps things is deleted for good, by the same job (a person's Assistant that went with them included). */
export async function sweepExpired(ctx: AgentsCtx): Promise<string[]> {
  ensure(ctx.db);
  const keep = await trashKeepMs(ctx);
  if (keep === null) return [];
  const due = ctx.db.all(
    `SELECT * FROM agents_agent WHERE deletedAt IS NOT NULL AND deletedAt <= ? AND id NOT IN (SELECT agentId FROM agents_erase) ORDER BY deletedAt LIMIT 20`,
    ctx.now() - keep,
  ) as Row[];
  for (const r of due) start(ctx, agentOf(r), "system");
  return due.map((r) => String(r["id"]));
}
