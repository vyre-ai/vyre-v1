// Export and import portable Automation definitions.
// An export carries the definition only. Connections become numbered slots, personal keys are dropped, and nothing from runs or the Vault is read.
// An import makes a Personal Draft, puts the importer's own connections into the slots they chose, and lists what is still left to connect.
import { canView, create } from "./defs.ts";
import { getAutomation, me, newId, raise } from "../projections.ts";
import type { AutoCtx, Definition } from "../projections.ts";

type In = Record<string, unknown>;

interface PackageRow {
  id: string;
  name: string;
  source_automation_id: string;
  owner_id: string;
  definition: string;
  requires: string;
  created_at: number;
}

export interface Slot { slot: string; label: string; stepIds: string[] }
export interface Requires { connections: Slot[]; vault: string[]; keys: string[] }

const CONNECTION = /^con_[a-z0-9]+$/;
const SLOT = /^con_slot[0-9]+$/;
const HANDLE = /#[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?/g;
const PERSONAL_KEYS = new Set(["keyId", "backupKeyId"]);

function owned(ctx: AutoCtx, id: string): PackageRow | undefined {
  const rows = ctx.db.all(
    "SELECT id, name, source_automation_id, owner_id, definition, requires, created_at FROM automations_packages WHERE id = ? AND owner_id = ?",
    id,
    me(ctx),
  ) as PackageRow[];
  return rows[0];
}

const rowOut = (row: { id: string; name: string; source_automation_id: string; created_at: number; requires?: string }) => ({
  id: row.id,
  name: row.name,
  sourceAutomationId: row.source_automation_id,
  createdAt: row.created_at,
  requires: parseRequires(row.requires),
});

function parseRequires(raw: string | undefined): Requires {
  try {
    const got = JSON.parse(raw ?? "{}") as Partial<Requires>;
    return {
      connections: Array.isArray(got.connections) ? got.connections : [],
      vault: Array.isArray(got.vault) ? got.vault : [],
      keys: Array.isArray(got.keys) ? got.keys : [],
    };
  } catch {
    return { connections: [], vault: [], keys: [] };
  }
}

/** Copy a definition for sharing: connections become slots, personal keys go, and the names a step reads from the Vault are listed. */
export function scrub(def: Definition): { definition: Definition; requires: Requires } {
  const slotOf = new Map<string, string>();
  const users = new Map<string, Set<string>>();
  const vault = new Set<string>();
  const keys = new Set<string>();
  let at = "";
  const copy = (value: unknown): unknown => {
    if (typeof value === "string") {
      for (const m of value.match(HANDLE) ?? []) vault.add(m);
      if (!CONNECTION.test(value)) return value;
      let slot = slotOf.get(value);
      if (!slot) { slot = `con_slot${slotOf.size + 1}`; slotOf.set(value, slot); }
      (users.get(slot) ?? users.set(slot, new Set()).get(slot)!).add(at);
      return slot;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (PERSONAL_KEYS.has(k)) { if (at) keys.add(at); continue; }
        out[k] = copy(v);
      }
      return out;
    }
    return value;
  };
  const out: Definition = {
    ...(def.start ? { start: [...def.start] } : {}),
    ...(def.allowSelfTrigger !== undefined ? { allowSelfTrigger: def.allowSelfTrigger } : {}),
    triggers: def.triggers.map((t) => copy(t) as Definition["triggers"][number]),
    nodes: def.nodes.map((n) => { at = n.id; return copy(n) as Definition["nodes"][number]; }),
  };
  const connections: Slot[] = [...slotOf.values()].map((slot, i) => ({ slot, label: `Connection ${i + 1}`, stepIds: [...(users.get(slot) ?? [])].filter(Boolean) }));
  return { definition: out, requires: { connections, vault: [...vault].sort(), keys: [...keys].sort() } };
}

function remap(value: unknown, pick: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return pick.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, pick));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remap(v, pick)]));
  return value;
}

export async function packagesList(ctx: AutoCtx): Promise<unknown> {
  const rows = ctx.db.all(
    "SELECT id, name, source_automation_id, created_at, requires FROM automations_packages WHERE owner_id = ? ORDER BY created_at DESC, id DESC",
    me(ctx),
  ) as PackageRow[];
  return { packages: rows.map(rowOut) };
}

export async function exportPackage(ctx: AutoCtx, input: In): Promise<unknown> {
  const automationId = typeof input.automationId === "string" ? input.automationId : "";
  if (!automationId) raise(ctx, "validation.bad_input", "Export needs an automation.");
  const automation = getAutomation(ctx, automationId);
  if (!canView(ctx, automation)) raise(ctx, "permission.not_found", "That automation is not available.");
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : automation.name;
  const id = newId("pkg", ctx.now());
  const createdAt = ctx.now();
  const { definition, requires } = scrub(automation.definition);
  ctx.db.run(
    "INSERT INTO automations_packages (id, name, source_automation_id, owner_id, definition, created_at, requires) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, name, automation.id, me(ctx), JSON.stringify(definition), createdAt, JSON.stringify(requires),
  );
  return { package: rowOut({ id, name, source_automation_id: automation.id, created_at: createdAt, requires: JSON.stringify(requires) }) };
}

async function visibleConnections(ctx: AutoCtx): Promise<Set<string>> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Connections are not available right now.");
  const got = await ctx.call("connections.list", { whose: "all", limit: 500 }) as { connections?: { id?: unknown }[] };
  return new Set((got?.connections ?? []).map((c) => c.id).filter((id): id is string => typeof id === "string"));
}

export async function importPackage(ctx: AutoCtx, input: In): Promise<unknown> {
  const packageId = typeof input.packageId === "string" ? input.packageId : "";
  const row = packageId ? owned(ctx, packageId) : undefined;
  if (!row) raise(ctx, "validation.not_found", "That package is not available.");
  let definition: Definition;
  try {
    const parsed: unknown = JSON.parse(row.definition);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a definition");
    definition = parsed as Definition;
  } catch {
    raise(ctx, "validation.bad_input", "That package does not hold a definition.");
  }
  const requires = parseRequires(row.requires);
  const chosen = input.connections && typeof input.connections === "object" && !Array.isArray(input.connections) ? input.connections as Record<string, unknown> : {};
  const pick = new Map<string, string>();
  const mine = Object.keys(chosen).length > 0 ? await visibleConnections(ctx) : new Set<string>();
  for (const [slot, to] of Object.entries(chosen)) {
    if (!SLOT.test(slot) || !requires.connections.some((c) => c.slot === slot)) raise(ctx, "validation.bad_input", "That package has no such connection slot.", { reason: "no_slot", slot });
    if (typeof to !== "string" || !mine.has(to)) raise(ctx, "validation.bad_input", "Choose a connection you can use.", { reason: "not_your_connection", slot });
    pick.set(slot, to);
  }
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : row.name;
  const made = await create(ctx, { name, definition: remap(definition, pick) as Definition }) as { automation: unknown };
  const left = {
    connections: requires.connections.filter((c) => !pick.has(c.slot)),
    vault: requires.vault,
    keys: requires.keys,
  };
  return { automation: made.automation, needs: left };
}
