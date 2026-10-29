// /hooks/google/<kind>: the intake for Google's pushes (Gmail and Meet through Pub/Sub, Calendar and Drive through watch channels). The host reaches it through
// `google.accept_webhook` (a host call; the webhook route is the only way in). Google signs none of these with a key we hold, so the credential is the push secret
// (pushToken): the channel token Google echoes on every Calendar and Drive notice, and the `token` query on the Pub/Sub endpoint address. Nothing is recorded until it matches.
import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, first, pushToken } from "../projections.ts";
import type { GoogleCtx } from "../projections.ts";
import { receivePush } from "./workspace.ts";

export interface HookIn { headers: Readonly<Record<string, string | undefined>>; body: string; url: string; kind?: string }

const KINDS = ["gmail", "calendar", "drive", "meet"] as const;
type Kind = (typeof KINDS)[number];
const EMAIL = /^[^\s@]+@[^\s@]+$/;

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();
/** Equal secrets without a timing signal. */
export const sameSecret = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

function refuse(ctx: GoogleCtx): never {
  throw fail("auth.bad_credentials", ctx.trace.traceId, { message: "That request did not come from Google." });
}

/** The secret as Google sent it: the channel token header, or the `token` query of the Pub/Sub address. */
function sent(h: HookIn): string {
  const header = h.headers["x-goog-channel-token"];
  if (header) return header;
  try { return new URL(h.url).searchParams.get("token") ?? ""; } catch { return ""; }
}

export async function acceptHook(ctx: GoogleCtx, h: HookIn): Promise<{ accepted: boolean }> {
  const kind = KINDS.find((k) => k === h.kind);
  if (!kind) bad(ctx, "That is not a Google push address.");
  const given = sent(h);
  // No secret yet means nothing was ever watched: refuse the same way as a wrong one, so a caller learns nothing.
  const haveRow = first(ctx.db.all(`SELECT token FROM google_push_secret WHERE id = ?`, "google"));
  if (!given || !haveRow || !sameSecret(given, pushToken(ctx))) refuse(ctx);
  return kind === "calendar" || kind === "drive" ? channelNotice(ctx, kind, h) : pubsubNotice(ctx, kind as "gmail" | "meet", h);
}

function channelNotice(ctx: GoogleCtx, kind: "calendar" | "drive", h: HookIn) {
  const channelId = h.headers["x-goog-channel-id"], number = h.headers["x-goog-message-number"];
  if (!channelId || !number) bad(ctx, "That is not a Google channel notice.");
  const resourceState = h.headers["x-goog-resource-state"], resourceId = h.headers["x-goog-resource-id"];
  return receivePush(ctx, {
    kind, messageId: `${channelId}:${number}`, channelId, ...(resourceState ? { resourceState } : {}), ...(resourceId ? { resourceId } : {}),
  });
}

function pubsubNotice(ctx: GoogleCtx, kind: "gmail" | "meet", h: HookIn) {
  let message: { messageId?: unknown; data?: unknown } | undefined;
  try { message = (JSON.parse(h.body) as { message?: { messageId?: unknown; data?: unknown } }).message; } catch { /* refused below */ }
  if (!message || typeof message.messageId !== "string" || !message.messageId) bad(ctx, "That is not a Pub/Sub push.");
  let data: { emailAddress?: unknown; historyId?: unknown } = {};
  if (typeof message.data === "string") {
    try { data = JSON.parse(Buffer.from(message.data, "base64").toString("utf8")) as typeof data; } catch { bad(ctx, "That Pub/Sub message has no readable data."); }
  }
  const mailbox = typeof data.emailAddress === "string" && EMAIL.test(data.emailAddress) ? data.emailAddress : undefined;
  if (kind === "gmail" && !mailbox) bad(ctx, "That Gmail push names no mailbox.");
  const historyId = typeof data.historyId === "string" || typeof data.historyId === "number" ? String(data.historyId) : undefined;
  return receivePush(ctx, { kind, messageId: message.messageId, ...(mailbox ? { mailbox } : {}), ...(historyId ? { historyId } : {}) });
}
