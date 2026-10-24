// console-assistant: the Console assistant behind Cmd-J (spec 3.10, ARCH 7.10).
// The thread is a chat thread; this module keeps whose it is and the page it follows, the Engineer toolset a person may use, and the diff cards the assistant proposes.
// Nothing is applied by the assistant: a person presses Apply, and the change runs as that person through ctx.call, so every permission check is the real one.
import { readFileSync } from "node:fs";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { CapName, ErrorCode, Level } from "../../packages/contracts/src/types.ts";
import { fail } from "../../host/src/routes/errors.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type AssistCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call" | "authorize" | "log">;

export type DiffKind = "role" | "grant" | "schema" | "policy" | "setting" | "connector" | "config";
export type DiffState = "proposed" | "filed" | "applied" | "rejected";
export interface Change { path: string; before: unknown; after: unknown }
export interface ThreadRec { person_id: string; thread_id: string; assistant_id: string; page: string; object_ref: string | null; opened_at: number; updated_at: number }
export interface DiffRec {
  diff_id: string; thread_id: string; kind: DiffKind; title: string; affects: string | null; changes_json: string; proposed_by_kind: string; proposed_by_id: string;
  proposed_at: number; state: DiffState; decided_by: string | null; decided_at: number | null; audit_id: string | null; task_id: string | null; note: string | null;
}

export function raise(ctx: Pick<AssistCtx, "trace">, code: ErrorCode, message?: string): never {
  throw fail(code, ctx.trace.traceId, message ? { message } : {});
}

// ---- reading what other modules answered

export const asRow = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const asList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(asRow).filter((r): r is Record<string, unknown> => r !== null) : []);
export const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** The person a call is for: the signed-in person, or the person an agent acts for. */
export function personOf(ctx: AssistCtx): string {
  if (ctx.principal.kind === "person") return ctx.principal.id;
  if (ctx.principal.kind === "agent" && ctx.actingFor) return ctx.actingFor;
  return raise(ctx, "permission.no_grant", "The Console assistant works for a person.");
}

export const threadOf = (ctx: AssistCtx, personId: string): ThreadRec | undefined =>
  ctx.db.all(`SELECT * FROM console_assistant_thread WHERE person_id = ?`, personId)[0] as ThreadRec | undefined;
export const threadById = (ctx: AssistCtx, threadId: string): ThreadRec | undefined =>
  ctx.db.all(`SELECT * FROM console_assistant_thread WHERE thread_id = ?`, threadId)[0] as ThreadRec | undefined;
export const diffOf = (ctx: AssistCtx, diffId: string): DiffRec | undefined =>
  ctx.db.all(`SELECT * FROM console_assistant_diff WHERE diff_id = ?`, diffId)[0] as DiffRec | undefined;

/** The thread must exist and belong to the person; anyone else gets "not found" so a thread id leaks nothing. */
export function ownThread(ctx: AssistCtx, threadId: string): ThreadRec {
  const t = threadById(ctx, threadId);
  if (!t || t.person_id !== personOf(ctx)) return raise(ctx, "validation.not_found", "No such assistant thread.");
  return t;
}

export const changesOf = (d: DiffRec): Change[] => JSON.parse(d.changes_json) as Change[];

// ---- the plan behind Apply

/** A diff that cannot be turned into capability calls. At propose time nothing is judged (the card is only a proposal); Apply says why it will not run. */
export class PlanError extends Error {}

export interface Step {
  label: string;
  /** The permission the target needs, checked up front so a person who lacks it files the change instead of failing half way. Null: the target decides. */
  perm: string | null;
  level: Level;
  run(ctx: AssistCtx): Promise<unknown>;
}

const ROLE = /^rol_[a-z0-9]+$/;
const GRANT = /^gnt_[a-z0-9]+$/;
const CONN = /^con_[a-z0-9]+$/;
const CLEARANCE = new Set(["public", "internal", "confidential", "restricted"]);
const GRANT_LEVELS = new Set(["view", "use", "edit", "manage"]);
const LOG_FIELDS = new Set(["level", "aggregateDays", "fullDays"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
export const BUG_PREFIX = "product:";
export const BUG_MESSAGE = "A product bug is reported with a support bundle, not a changeset. Open Diagnostics, create the bundle and send it.";

const call = (ctx: AssistCtx, cap: CapName, input: unknown): Promise<unknown> => ctx.call(cap, input);

/** Path and value rules per kind. Every path here names something the Space owns: a role, a grant, a policy, a setting, a schema, a connection, the log settings. */
export function planOf(kind: DiffKind, changes: readonly Change[], diffId: string, title: string): Step[] {
  if (changes.length === 0) throw new PlanError("This change has no edits.");
  for (const c of changes) if (c.path.startsWith(BUG_PREFIX)) throw new PlanError(BUG_MESSAGE);
  const grouped = (re: RegExp, what: string): Map<string, Map<string, unknown>> => {
    const by = new Map<string, Map<string, unknown>>();
    for (const c of changes) {
      const [id, field, ...rest] = c.path.split("/");
      if (!id || !field || rest.length > 0 || !re.test(id)) throw new PlanError(`"${c.path}" is not a ${what} edit. Use <id>/<field>.`);
      const fields = by.get(id) ?? new Map<string, unknown>();
      fields.set(field, c.after);
      by.set(id, fields);
    }
    return by;
  };
  const steps: Step[] = [];
  switch (kind) {
    case "setting":
      for (const c of changes) steps.push({ label: `Set ${c.path}`, perm: "policy.manage", level: "view", run: (x) => call(x, "settings.set_space", { key: c.path, value: c.after }) });
      return steps;
    case "policy":
      for (const c of changes) {
        const cut = c.path.indexOf("/");
        const scope = cut > 0 ? c.path.slice(0, cut) : "space";
        const key = cut > 0 ? c.path.slice(cut + 1) : c.path;
        if (!key) throw new PlanError(`"${c.path}" names no policy.`);
        steps.push({
          label: `${c.after === null ? "Reset" : "Set"} policy ${key}`, perm: "policy.manage", level: "view",
          run: (x) => (c.after === null ? call(x, "access.policies.reset", { key, scope }) : call(x, "access.policies.set", { key, scope, value: c.after })),
        });
      }
      return steps;
    case "role":
      for (const [roleId, fields] of grouped(ROLE, "role")) {
        const update: Record<string, unknown> = { roleId };
        for (const [field, v] of fields) {
          if (field === "name" && typeof v === "string" && v.trim()) update["name"] = v;
          else if (field === "clearance" && typeof v === "string" && CLEARANCE.has(v)) update["clearance"] = v;
          else if (field === "assignableToAgents" && typeof v === "boolean") update["assignableToAgents"] = v;
          else if (field === "permissions" && Array.isArray(v) && v.every((p) => typeof p === "string")) continue;
          else throw new PlanError(`${roleId}/${field} is not a role edit the Console can apply.`);
        }
        if (Object.keys(update).length > 1) steps.push({ label: `Update role ${roleId}`, perm: "access.manage", level: "view", run: (x) => call(x, "access.roles.update", update) });
        const permissions = fields.get("permissions");
        if (Array.isArray(permissions)) {
          steps.push({
            label: `Change what role ${roleId} may do`, perm: "access.manage", level: "view",
            run: async (x) => {
              // the matrix path: preview first, then apply exactly what the preview showed
              const preview = asRow(await call(x, "access.roles.preview", { roleId, permissions }));
              const previewHash = str(preview?.["previewHash"]);
              if (!previewHash) throw new PlanError(`The preview for ${roleId} came back without a hash.`);
              return call(x, "access.roles.apply", { roleId, permissions, previewHash });
            },
          });
        }
      }
      return steps;
    case "grant":
      for (const [grantId, fields] of grouped(GRANT, "grant")) {
        const update: Record<string, unknown> = { grantId };
        for (const [field, v] of fields) {
          if (field === "level" && typeof v === "string" && GRANT_LEVELS.has(v)) update["level"] = v;
          else if (field === "conditions" && asRow(v)) update["conditions"] = v;
          else throw new PlanError(`${grantId}/${field} is not a grant edit the Console can apply.`);
        }
        steps.push({ label: `Update grant ${grantId}`, perm: null, level: "manage", run: (x) => call(x, "access.grants.update", update) });
      }
      return steps;
    case "schema":
      changes.forEach((c, i) => {
        if (c.path !== "ops" || !Array.isArray(c.after)) throw new PlanError(`"${c.path}" is not a schema edit. Use the path "ops" with the list of operations.`);
        steps.push({ label: "Change the schema", perm: "schema.manage", level: "edit", run: (x) => call(x, "schema.apply", { ops: c.after, idempotencyKey: `console-${diffId}-${i}`, reason: title }) });
      });
      return steps;
    case "connector":
      for (const [connectionId, fields] of grouped(CONN, "connection")) {
        const paused = fields.get("paused");
        if (fields.size !== 1 || typeof paused !== "boolean") throw new PlanError(`${connectionId} can be paused or resumed here: use ${connectionId}/paused with true or false.`);
        steps.push({ label: `${paused ? "Pause" : "Resume"} ${connectionId}`, perm: null, level: "manage", run: (x) => call(x, paused ? "connections.pause" : "connections.resume", { connectionId }) });
      }
      return steps;
    case "config": {
      const set: Record<string, unknown> = {};
      for (const c of changes) {
        const [group, field, ...rest] = c.path.split("/");
        if (group !== "logging" || !field || rest.length > 0 || !LOG_FIELDS.has(field)) throw new PlanError(`"${c.path}" is not server config the Console can apply. Use logging/level, logging/aggregateDays or logging/fullDays.`);
        const ok = field === "level" ? typeof c.after === "string" && LOG_LEVELS.has(c.after) : typeof c.after === "number" && Number.isInteger(c.after) && c.after >= 1;
        if (!ok) throw new PlanError(`${c.path} has a value the log settings do not accept.`);
        set[field] = c.after;
      }
      return [{ label: "Change the log settings", perm: "policy.manage", level: "manage", run: (x) => call(x, "logs.settings_set", set) }];
    }
  }
}

/** True when the person may run every step now. */
export function mayRun(ctx: AssistCtx, steps: readonly Step[]): boolean {
  return steps.every((s) => s.perm === null || ctx.authorize({ perm: s.perm, level: s.level }, { type: "space", id: ctx.space }).effect === "allow");
}

// ---- the Engineer toolset

interface RegistryCap { name: string; summary: string; permission: string | null; level: Level; surfaces?: { mcp?: { toolset?: string; name?: string } | false } }
let cached: RegistryCap[] | null = null;
/** Capabilities in the Engineer toolset, from the frozen registry. */
export function engineerCaps(): RegistryCap[] {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { capabilities?: RegistryCap[] };
  cached = (raw.capabilities ?? []).filter((c) => (c.surfaces?.mcp ? c.surfaces.mcp.toolset === "engineer" : false));
  return cached;
}

/** The tools this person may use: every Engineer capability whose permission their roles hold. A capability with no permission is decided by grants at call time, so it is listed. */
export function toolsFor(ctx: AssistCtx): { name: string; summary: string }[] {
  const allowed = new Map<string, boolean>();
  const may = (perm: string, level: Level): boolean => {
    const key = `${perm}:${level}`;
    let ok = allowed.get(key);
    if (ok === undefined) {
      ok = ctx.authorize({ perm, level }, { type: "space", id: ctx.space }).effect === "allow";
      allowed.set(key, ok);
    }
    return ok;
  };
  return engineerCaps()
    .filter((c) => c.permission === null || may(c.permission, c.level))
    .map((c) => ({ name: (c.surfaces?.mcp ? c.surfaces.mcp.name : undefined) ?? c.name, summary: c.summary }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const contextText = (page: string, objectRef: string | undefined): string => `Console page: ${page}${objectRef ? ` (${objectRef})` : ""}`;
