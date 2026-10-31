// The Dropbox webhook (/hooks/dropbox): Dropbox says which accounts have changes, and nothing else, and the mounts read the change feed for the rest.
//   verification   a GET with ?challenge=... answered by the route itself (the text back, nosniff); it never reaches this module
//   a POST         x-dropbox-signature is the hex HMAC-SHA256 of the raw body under the app secret. The check comes first; a body that is not a Dropbox change is refused after it.
// DECISION: Dropbox sends no event id and no time, so the id is the hash of the body: the same delivery twice is one event, and two different deliveries are two.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, ensure, first, list, needConfig, needHost, obj, text } from "../projections.ts";
import type { DropboxCtx } from "../projections.ts";

const utf8 = (v: string) => new TextEncoder().encode(v);

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, utf8(data)))).toString("hex");
}

export async function sha256Hex(data: string): Promise<string> {
  return Buffer.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", utf8(data)))).toString("hex");
}

export async function signatureMatches(secret: string, body: string, signature: string): Promise<boolean> {
  const want = await hmacHex(secret, body);
  if (want.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);   // the whole string is read whatever the first difference
  return diff === 0;
}

export type Verified = { ok: true; input: { eventId: string; accounts: string[]; at: number } } | { ok: false; reason: "no_signature" | "bad_signature" | "bad_body" };

export async function verifyWebhook(secret: string, headers: Readonly<Record<string, string | undefined>>, body: string, now: number): Promise<Verified> {
  const signature = headers["x-dropbox-signature"];
  if (!signature) return { ok: false, reason: "no_signature" };
  if (!(await signatureMatches(secret, body, signature))) return { ok: false, reason: "bad_signature" };
  let parsed: Record<string, unknown>;
  try { parsed = obj(JSON.parse(body)); } catch { return { ok: false, reason: "bad_body" }; }
  const accounts = list(obj(parsed["list_folder"])["accounts"]).filter((a): a is string => typeof a === "string" && a !== "");
  if (accounts.length === 0 && !("list_folder" in parsed)) return { ok: false, reason: "bad_body" };
  return { ok: true, input: { eventId: (await sha256Hex(body)).slice(0, 32), accounts, at: now } };
}

/** The app secret the Vault holds, for one call. */
export async function webhookSecret(ctx: DropboxCtx): Promise<string> {
  return needHost(ctx).appSecret(ctx, needConfig(ctx).vaultItem);
}

/** Record a verified delivery once, and say which accounts changed. Mounts on those accounts read their change feeds. */
export function receiveWebhook(ctx: DropboxCtx, input: unknown) {
  ensure(ctx);
  const i = obj(input);
  const eventId = text(i["eventId"]);
  if (eventId === "") bad(ctx, "eventId is needed.");
  if (first(ctx.db.all(`SELECT "eventId" FROM dropbox_event WHERE "eventId" = ?`, eventId))) return { accepted: true };
  const accounts = list(i["accounts"]).filter((a): a is string => typeof a === "string");
  ctx.db.run(`INSERT OR IGNORE INTO dropbox_event ("eventId", "at") VALUES (?, ?)`, eventId, ctx.now());
  // events older than a day have done their job; the table stays small
  ctx.db.run(`DELETE FROM dropbox_event WHERE "at" < ?`, ctx.now() - 24 * 3600_000);
  ctx.emit("dropbox.changes_received", `entity/${eventId}`, { eventId, accounts });
  return { accepted: true };
}

export const refuseUnsigned = (traceId: string) => fail("auth.bad_credentials", traceId, { message: "That request was not signed by Dropbox." });
