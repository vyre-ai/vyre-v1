// Try one safe connector read. The Vault key value is not planned, sent, or returned.
// A successful read stores tested for the action key. The row holds no secret.
// With an app and an action, the request comes from the stored connector instead of from the caller (handlers/connector-run.ts).
import { tryStored } from "./connector-run.ts";
import { recordConnectorLevel } from "../connector-level.ts";
import type { LevelDb } from "../connector-level.ts";
import { planSafeTest, runSafeTest } from "../connector-test.ts";
import type { AutoCtx } from "../projections.ts";

type ReadSender = (plan: { method: string; url: string; vaultItemId: string }) => Promise<{ status: number }>;

const NO_SUCCESS = "The read did not succeed.";

let readSender: ReadSender | null = null;

export function setConnectorReadSender(next: ReadSender | null): void {
  readSender = next;
}

function actionKeyOf(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "";
  const key = (input as Record<string, unknown>).actionKey;
  return typeof key === "string" ? key : "";
}

function domainsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const domains: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    domains.push(item);
  }
  return domains;
}

// Only these fields are copied. A key value on the input is ignored.
function fieldsOf(input: unknown): { method: string; path: string; domains: string[]; markedSafe?: true; vaultItemId: string } | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const row = input as Record<string, unknown>;
  const domains = domainsOf(row.domains);
  if (typeof row.method !== "string" || typeof row.path !== "string" || typeof row.vaultItemId !== "string" || domains === undefined) {
    return undefined;
  }
  return {
    method: row.method,
    path: row.path,
    domains,
    vaultItemId: row.vaultItemId,
    ...(row.markedSafe === true ? { markedSafe: true as const } : {}),
  };
}

export async function tryConnectorRead(ctx: AutoCtx, input: unknown): Promise<{ level: "tested" | "draft"; reason?: string; status?: number; shape?: unknown; notes?: string[] }> {
  if (typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).app === "string") return tryStored(ctx, input as Record<string, unknown>);
  const fields = fieldsOf(input);
  if (fields === undefined) return { level: "draft", reason: NO_SUCCESS };

  const planned = planSafeTest({
    method: fields.method,
    path: fields.path,
    domains: fields.domains,
    vaultItemId: fields.vaultItemId,
    ...(fields.markedSafe === true ? { markedSafe: true } : {}),
  });
  if (!planned.ok) return { level: "draft", reason: planned.reason };
  if (readSender === null) return { level: "draft", reason: NO_SUCCESS };

  const outcome = await runSafeTest(planned.plan, readSender);
  if (outcome.level === "tested") {
    const actionKey = actionKeyOf(input);
    if (actionKey !== "" && ctx.db) recordConnectorLevel(ctx.db as LevelDb, actionKey, "tested", ctx.now());
    return { level: "tested" };
  }
  return { level: "draft", reason: outcome.reason };
}
