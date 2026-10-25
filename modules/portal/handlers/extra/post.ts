// portal.post: an outside account posts into the conversation of a record it may see (spec 3.6 Client portal; ARCH 7.6, 8.4).
// The record's channel main thread takes the message through chat.post, so it lands in the Inbox and the channel like any message. The call runs as the site
// service identity; the outside account is named in the first line of the message and in portal.message_posted (audit: always), never as a Space member.
// Only the account's linked record, or a row its rules show it, is a target. A record with no channel has no conversation yet and refuses the post.
// @reads ../../migrations/0001_portal_accounts.sql

import type { Ctx } from "../../../../packages/contracts/src/ctx.ts";
import { fail, linkedAccount, rec, reqStr, throttle, visibleRecords } from "./shared.ts";

const BODY_MAX = 10_000;
const POSTS = 20;
const WINDOW_MS = 15 * 60_000;

async function post(ctx: Ctx, input: unknown): Promise<{ messageId: string }> {
  const o = rec(ctx, input);
  const acct = linkedAccount(ctx, reqStr(ctx, o, "accountId"));
  const recordId = reqStr(ctx, o, "recordId");
  const text = reqStr(ctx, o, "body").trim();
  if (text.length === 0 || text.length > BODY_MAX || text.includes("\u0000")) fail(ctx, "validation.bad_input", `Write a message of up to ${BODY_MAX} characters.`, { field: "body" });
  const gate = throttle(ctx, `post|${acct.id}`, POSTS, WINDOW_MS);

  const target = (await visibleRecords(ctx, acct)).find((r) => r.id === recordId);
  if (!target) fail(ctx, "permission.not_found", "That record is not available to this account.");

  // The channel is read from the record itself, not from the visible copy: a row rule may hide the field.
  const got = (await ctx.call("records.get", { type: target.type, recordId })) as { record?: { fields?: Record<string, unknown> } };
  const channelId = got.record?.fields?.channel;
  if (typeof channelId !== "string" || channelId.length === 0) fail(ctx, "validation.precondition_failed", "This record has no conversation yet.");
  const ch = (await ctx.call("channels.get", { channelId })) as { channel?: { mainThreadId?: unknown; archived?: unknown } };
  const threadId = ch.channel?.mainThreadId;
  if (typeof threadId !== "string" || ch.channel?.archived === true) fail(ctx, "validation.precondition_failed", "This conversation is closed.");

  const sent = (await ctx.call("chat.post", { threadId, body: `From ${acct.email} (client portal)\n\n${text}` })) as { message?: { messageId?: unknown } };
  const messageId = sent.message?.messageId;
  if (typeof messageId !== "string") fail(ctx, "internal.unexpected", "The message could not be posted.");
  gate.bump();
  ctx.emit("portal.message_posted", `record/${recordId}`, { accountId: acct.id, recordId, messageId });
  return { messageId };
}

export const postHandlers = {
  "portal.post": (ctx: Ctx, input: unknown) => post(ctx, input),
};

