// /hooks/microsoft: the intake for Microsoft Graph change notifications. The host reaches it through `microsoft.accept_webhook` (a host call; the webhook route is the only way in).
// Graph's credential is the clientState we chose when we made the subscription and it echoes on every notice: a notice is recorded only when its subscription is one of ours and the
// clientState matches that subscription's. The first request of a new subscription is Graph's validation handshake; it carries no body, only a validationToken to hand back.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, first, str, text } from "../projections.ts";
import type { MsCtx } from "../projections.ts";
import { receiveNotification } from "./subscriptions.ts";

export interface HookIn { headers: Readonly<Record<string, string | undefined>>; body: string; url: string; kind?: string }

const MAX_NOTICES = 100;
const sha256 = async (s: string): Promise<Uint8Array> => new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
/** Equal client states without a timing signal: both are hashed to the same length and compared in full. */
export async function sameState(a: string, b: string): Promise<boolean> {
  const x = await sha256(a), y = await sha256(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

function refuse(ctx: MsCtx): never {
  throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request did not come from Microsoft." });
}

export async function acceptHook(ctx: MsCtx, h: HookIn): Promise<{ accepted: boolean; validationToken?: string }> {
  let handshake: string | null = null;
  try { handshake = new URL(h.url).searchParams.get("validationToken"); } catch { /* no query */ }
  if (handshake !== null) {
    // Graph only sends this when it creates a subscription. The answer is the token, as text; a printable token of sane length is all that is echoed.
    if (!/^[\x20-\x7e]{1,2048}$/.test(handshake)) bad(ctx, "That validation token is not valid.");
    return { accepted: true, validationToken: handshake };
  }
  let notices: unknown[] = [];
  try {
    const v = (JSON.parse(h.body) as { value?: unknown }).value;
    if (Array.isArray(v)) notices = v;
  } catch { /* refused below */ }
  if (notices.length === 0 || notices.length > MAX_NOTICES) bad(ctx, "That is not a Graph notification.");
  // Check every notice before recording any: one that is not ours fails the whole request, so a forged one cannot ride in with real ones.
  const checked: { notificationId: string; subscriptionId: string; resource: string; changeType: "created" | "updated" | "deleted"; clientStateOk: true; tenantId?: string }[] = [];
  for (const n of notices) {
    const o = (n !== null && typeof n === "object" ? n : {}) as Record<string, unknown>;
    const subscriptionId = typeof o.subscriptionId === "string" ? o.subscriptionId : "";
    const state = typeof o.clientState === "string" ? o.clientState : "";
    const row = subscriptionId ? first(ctx.db.all(`SELECT "clientState" FROM microsoft_subscription WHERE id = ?`, subscriptionId)) : null;
    if (!row || !state || !(await sameState(state, str(row, "clientState")))) refuse(ctx);
    const resource = typeof o.resource === "string" ? o.resource : "";
    const changeType = o.changeType === "created" || o.changeType === "updated" || o.changeType === "deleted" ? o.changeType : null;
    if (!resource || !changeType) bad(ctx, "That is not a Graph notification.");
    const resourceData = o.resourceData !== null && typeof o.resourceData === "object" ? (o.resourceData as Record<string, unknown>) : {};
    // Graph numbers none of its notices; a stable digest of what identifies the change lets a redelivery be taken once.
    const bytes = await sha256(JSON.stringify([subscriptionId, resource, changeType, text(resourceData.id) ?? "", text(resourceData["@odata.etag"]) ?? ""]));
    const notificationId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
    checked.push({ notificationId, subscriptionId, resource, changeType, clientStateOk: true, ...(typeof o.tenantId === "string" ? { tenantId: o.tenantId } : {}) });
  }
  let any = false;
  for (const n of checked) if ((await receiveNotification(ctx, n)).accepted) any = true;
  return { accepted: any };
}
