// Vault > Connections, what the Add sheet and the row menu do, as plain calls so a test drives exactly what the page does. Keys go into the Vault first (a Mine folder for a Mine connection, a
// Shared folder for a Space one, so every member's call can fill it), and the connection keeps only the handle, in its environment or a header, never in its command line. After adding, the
// connection is checked through the person's assistant (engine.mcp.tools for that one server); the engine records the result on the connection, so the dot on the page is the same answer.
import type { ConnectionDraft } from "../../../../../../lib/mcp-import.ts";
import { healthFromTest, itemName } from "./model.ts";
import type { Health } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;

const key = (): string => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** The Shared folder Space keys go in when the Space has none yet; a Mine key goes in the person's Mine folder. */
export const SPACE_KEY_FOLDER = "Connections";

async function folderFor(call: Call, scope: "mine" | "space"): Promise<string> {
  const folders = ((await call("vault.folders.list", {})) as { folders: { id: string; scope: string; yourLevel?: string }[] }).folders;
  const want = scope === "mine" ? "mine" : "shared";
  const found = folders.find((f) => f.scope === want && (f.yourLevel === undefined || f.yourLevel === "edit" || f.yourLevel === "manage"));
  if (found) return found.id;
  return ((await call("vault.folders.create", { name: scope === "mine" ? "Mine" : SPACE_KEY_FOLDER, scope: want, idempotencyKey: key() })) as { folder: { id: string } }).folder.id;
}

/** One Vault item holding a connection's keys as fields; answers the handle of each field (#Item.FIELD). The values never come back. */
export async function fileKeys(call: Call, scope: "mine" | "space", connection: string, values: ReadonlyArray<{ key: string; value: string }>): Promise<Record<string, string>> {
  if (values.length === 0) return {};
  const folderId = await folderFor(call, scope);
  const fieldKey = (k: string): string => k.replace(/[^A-Za-z0-9_]+/g, "_") || "key";
  const name = itemName(connection, "key");
  const put = (await call("vault.item.put", { folderId, name, kind: "api_key", fields: values.map((v) => ({ key: fieldKey(v.key), value: v.value, secret: true })), idempotencyKey: key() })) as { item: { handle: string } };
  const base = put.item.handle || `#${name}`;
  return Object.fromEntries(values.map((v) => [v.key, `${base}.${fieldKey(v.key)}`]));
}

export interface AddPlan {
  scope: "mine" | "space";
  name: string;
  title?: string;
  draft: ConnectionDraft;
  /** Values the person typed for the draft's needs, and the keys found in what they pasted (draft.secrets), by key name. */
  typed: Record<string, string>;
  /** Sign in with OAuth (a remote that holds no key). */
  oauth: boolean;
  source: "registry" | "paste" | "import";
  sourceRef?: string;
  share?: string[];
}

export interface Added { connectionId: string; key: string; health: Health; tools?: number; note?: string }

/** Saves the keys, adds the connection and checks it. Rejects with the capability's words when something is refused; nothing is half-made before the add (keys are saved first on purpose: a refused add leaves only a Vault item the person can see and remove). */
export async function addFromPlan(call: Call, plan: AddPlan, assistantId: string | undefined): Promise<Added> {
  const d = plan.draft;
  const secretKeys = [
    ...d.secrets.map((s) => ({ key: s.key, into: s.into, prefix: s.prefix ?? "", value: plan.typed[s.key] ?? s.value })),
    ...d.needs.filter((n) => n.secret).map((n) => ({ key: n.key, into: n.into, prefix: n.prefix ?? "", value: plan.typed[n.key] ?? "" })),
  ].filter((s) => s.value.trim() !== "");
  const plain = d.needs.filter((n) => !n.secret && (plan.typed[n.key] ?? "").trim() !== "");
  const handles = await fileKeys(call, plan.scope, plan.name, secretKeys.map((s) => ({ key: s.key, value: s.value.trim() })));
  const env: Record<string, string> = { ...d.env }, headers: Record<string, string> = { ...d.headers };
  for (const s of secretKeys) (s.into === "env" ? env : headers)[s.key] = `${s.prefix}${handles[s.key]}`;
  for (const n of plain) (n.into === "env" ? env : headers)[n.key] = `${n.prefix ?? ""}${plan.typed[n.key]!.trim()}`;
  const body = {
    name: plan.name, ...(plan.title ? { title: plan.title } : {}), ...(d.url ? { url: d.url } : { command: d.command, args: d.args }),
    ...(Object.keys(env).length ? { env } : {}), ...(Object.keys(headers).length ? { headers } : {}), ...(plan.oauth && Object.keys(headers).length === 0 && d.url ? { auth: "oauth" } : {}),
    source: plan.source, ...(plan.sourceRef ? { sourceRef: plan.sourceRef } : {}), idempotencyKey: key(),
  };
  const out = plan.scope === "mine"
    ? ((await call("plugins.connection.add_mine", body)) as { connection: { connectionId: string; name: string } }).connection
    : ((await call("plugins.connection.add", { ...body, scope: "space", ...(plan.share ? { share: plan.share } : {}) })) as { connection: { connectionId: string; name: string } }).connection;
  const checked = await check(call, { key: out.name, connectionId: out.connectionId, oauth: body.auth === "oauth" }, assistantId);
  // a remote that holds no key and answers 401 wants a sign-in: switch it to OAuth so Sign in works
  if (d.url && !body.auth && Object.keys(headers).length === 0 && checked.health === "key_refused") {
    await call("plugins.connection.update", { connectionId: out.connectionId, auth: "oauth", idempotencyKey: key() });
    return { connectionId: out.connectionId, key: out.name, health: "needs_signin", note: "This server signs in with your account." };
  }
  return { connectionId: out.connectionId, key: out.name, ...checked };
}

/** Test: list one server's tools through the person's assistant. The engine records the result on the connection as well. */
export async function check(call: Call, row: { key: string; connectionId?: string | undefined; oauth: boolean }, assistantId: string | undefined): Promise<{ health: Health; tools?: number; note?: string }> {
  if (!assistantId) return { health: "unknown", note: "There is no assistant to check it with." };
  try {
    const r = (await call("engine.mcp.tools", { agentId: assistantId, server: row.key })) as { servers: { key: string; ok: boolean; error?: string; tools: unknown[] }[] };
    const h = healthFromTest(r.servers.find((s) => s.key === row.key), row.oauth);
    return { health: h.health, ...(h.tools !== undefined ? { tools: h.tools } : {}), ...(h.note ? { note: h.note } : {}) };
  } catch (e) { return { health: "not_answering", note: messageOf(e) }; }
}

/** Starts an OAuth sign-in and answers the address to open (the sign-in comes back to /oauth/callback, which finishes it). */
export async function signIn(call: Call, connectionId: string, origin: string): Promise<string> {
  const out = (await call("engine.mcp.oauth_start", { connectionId, redirectUri: `${origin}/oauth/callback` })) as { authUrl: string };
  return out.authUrl;
}

export function messageOf(e: unknown): string {
  const x = e as { error?: { message?: string }; message?: string };
  return x?.error?.message ?? x?.message ?? "That did not work.";
}

export { key as attemptKey };
