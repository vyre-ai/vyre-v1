// Try one safe connector read. The Vault key value is not planned, sent, or returned.
// A successful read stores tested for the action key. The row holds no secret.
// The address is checked like every other fetch here (https, a public host, also after DNS) before the key leaves the Vault, and a failed read says why in one line with what to do next.
import { lookup } from "node:dns/promises";
import { documentNetwork } from "../document-network.ts";
import { vetPublic } from "../public-fetch.ts";
import { recordConnectorLevel } from "../connector-level.ts";
import type { LevelDb } from "../connector-level.ts";
import { planSafeTest, runSafeTest } from "../connector-test.ts";
import type { AutoCtx } from "../projections.ts";

/** `asker` is the person the read is for: a key in their own Mine folder is released to them and no one else. */
/** `failed` says which side a status 0 came from: the Vault did not give the key, or the app never answered. */
type ReadSender = (plan: { method: string; url: string; vaultItemId: string; header?: string; prefix?: string }, asker?: string) => Promise<{ status: number; failed?: "vault" | "network" }>;

const HEADER = /^[A-Za-z0-9-]{1,40}$/;
const PREFIX = /^[\x20-\x7e]{0,20}$/;

const NO_SUCCESS = "The read did not succeed.";

async function lookupHost(h: string): Promise<string[]> {
  const rows = await lookup(h, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

/** The line a person reads for a read that did not pass: what the app said, and the next thing to check. */
export function readFailureLine(status: number | undefined, failed: "vault" | "network" | undefined, vaultItemId: string): string {
  const item = vaultItemId.split(".")[0] ?? vaultItemId;
  if (failed === "vault") return `The Vault did not give this read the key ${item}. Check the item is there and that you can use it.`;
  if (status === undefined || status <= 0) return "The app did not answer. Check the base address, then try again.";
  if (status === 401 || status === 403) return `The app refused the key (${status}). Check the key in the Vault, and how it is sent (header and prefix).`;
  if (status === 404) return `Nothing at that address (${status}). Check the base address and the path.`;
  if (status === 429) return `The app asked to slow down (${status}). Try again in a minute.`;
  if (status >= 500) return `The app had a problem (${status}). Try again later.`;
  if (status >= 300 && status < 400) return `The app sent the read somewhere else (${status}). Use the address it moved to.`;
  return `The read did not pass (${status}). Check the path and what the app expects.`;
}

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
  // the key is about to go on this request: a private, loopback or metadata address (or a name that resolves to one) is refused first, as the docs fetcher and the HTTP step refuse it
  const vetted = await vetPublic(planned.plan.url, documentNetwork()?.lookup ?? lookupHost);
  if (!vetted.ok) return { level: "draft", reason: vetted.reason };

  let status: number | undefined;
  let failed: "vault" | "network" | undefined;
  const sender = readSender;
  const outcome = await runSafeTest(planned.plan, async (plan) => { const r = await sender({ ...plan, ...(fields.header ? { header: fields.header } : {}), ...(fields.prefix !== undefined ? { prefix: fields.prefix } : {}) }, ctx.actingFor ?? ctx.principal?.id); status = r.status; failed = r.failed; return r; });
  // the status the app answered, so the person sees "401" and not only "did not succeed"; 0 means the request never got an answer
  const answered = status !== undefined && status > 0 ? { status } : {};
  if (outcome.level === "tested") {
    const actionKey = actionKeyOf(input);
    if (actionKey !== "" && ctx.db) recordConnectorLevel(ctx.db as LevelDb, actionKey, "tested", ctx.now());
    return { level: "tested", ...answered };
  }
  return { level: "draft", reason: readFailureLine(status, failed, fields.vaultItemId), ...answered };
}
