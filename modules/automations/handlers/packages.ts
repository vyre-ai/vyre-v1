// Export and import portable Automation definitions. The catalog is empty until a person exports one.
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
  created_at: number;
}

function owned(ctx: AutoCtx, id: string): PackageRow | undefined {
  const rows = ctx.db.all(
    "SELECT id, name, source_automation_id, owner_id, definition, created_at FROM automations_packages WHERE id = ? AND owner_id = ?",
    id,
    me(ctx),
  ) as PackageRow[];
  return rows[0];
}

export async function packagesList(ctx: AutoCtx): Promise<unknown> {
  const rows = ctx.db.all(
    "SELECT id, name, source_automation_id, created_at FROM automations_packages WHERE owner_id = ? ORDER BY created_at DESC, id DESC",
    me(ctx),
  ) as { id: string; name: string; source_automation_id: string; created_at: number }[];
  return {
    packages: rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceAutomationId: row.source_automation_id,
      createdAt: row.created_at,
    })),
  };
}

export async function exportPackage(ctx: AutoCtx, input: In): Promise<unknown> {
  const automationId = typeof input.automationId === "string" ? input.automationId : "";
  if (!automationId) raise(ctx, "validation.bad_input", "Export needs an automation.");
  const automation = getAutomation(ctx, automationId);
  if (!canView(ctx, automation)) raise(ctx, "permission.not_found", "That automation is not available.");
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : automation.name;
  const id = newId("pkg", ctx.now());
  const createdAt = ctx.now();
  ctx.db.run(
    "INSERT INTO automations_packages (id, name, source_automation_id, owner_id, definition, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, name, automation.id, me(ctx), JSON.stringify(automation.definition), createdAt,
  );
  return { package: { id, name, sourceAutomationId: automation.id, createdAt } };
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
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : row.name;
  return create(ctx, { name, definition });
}
