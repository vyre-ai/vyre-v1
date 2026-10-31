// Try one safe connector read. The Vault key value is not planned, sent, or returned.
// A successful read stores tested for the action key. The row holds no secret.
import { recordConnectorLevel } from "../connector-level.ts";
import type { LevelDb } from "../connector-level.ts";
import { planSafeTest, runSafeTest } from "../connector-test.ts";
import type { AutoCtx } from "../projections.ts";

/** `asker` is the person the read is for: a key in their own Mine folder is released to them and no one else. */
type ReadSender = (plan: { method: string; url: string; vaultItemId: string; header?: string; prefix?: string }, asker?: string) => Promise<{ status: number }>;

const HEADER = /^[A-Za-z0-9-]{1,40}$/;
const PREFIX = /^[\x20-\x7e]{0,20}$/;

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
function fieldsOf(input: unknown): { method: string; path: string; domains: string[]; markedSafe?: true; vaultItemId: string; header?: string; prefix?: string } | undefined {
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
    // how the app wants the key: a header name and a prefix, as the docs say (X-Api-Key, or Authorization with "Bearer ")
    ...(typeof row.header === "string" && HEADER.test(row.header) ? { header: row.header } : {}),
    ...(typeof row.prefix === "string" && PREFIX.test(row.prefix) ? { prefix: row.prefix } : {}),
  };
}

export async function tryConnectorRead(ctx: AutoCtx, input: unknown): Promise<{ level: "tested" | "draft"; reason?: string; status?: number }> {
  const fields = fieldsOf(input);
  if (fields === undefined) return { level: "draft", reason: NO_SUCCESS };

  // an agent never marks a write safe: it tries reads and nothing else
  const agent = ctx.principal?.kind === "agent";
  const planned = planSafeTest({
    method: fields.method,
    path: fields.path,
    domains: fields.domains,
    vaultItemId: fields.vaultItemId,
    ...(fields.markedSafe === true && !agent ? { markedSafe: true } : {}),
  });
  if (!planned.ok) return { level: "draft", reason: planned.reason };
  if (readSender === null) return { level: "draft", reason: NO_SUCCESS };

  let status: number | undefined;
  const sender = readSender;
  const outcome = await runSafeTest(planned.plan, async (plan) => { const r = await sender({ ...plan, ...(fields.header ? { header: fields.header } : {}), ...(fields.prefix !== undefined ? { prefix: fields.prefix } : {}) }, ctx.actingFor ?? ctx.principal?.id); status = r.status; return r; });
  // the status the app answered, so the person sees "401" and not only "did not succeed"; 0 means the request never got an answer
  const answered = status !== undefined && status > 0 ? { status } : {};
  if (outcome.level === "tested") {
    const actionKey = actionKeyOf(input);
    if (actionKey !== "" && ctx.db) recordConnectorLevel(ctx.db as LevelDb, actionKey, "tested", ctx.now());
    return { level: "tested", ...answered };
  }
  return { level: "draft", reason: outcome.reason, ...answered };
}
