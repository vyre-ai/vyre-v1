// The tool models are shown for a sent message's delivery (mail.delivery_state): one read that gives the trail of a message. Templates and inbox health are actions of mail.configure (handlers/setup.ts).
import { bad } from "../../projections.ts";
import type { MailCtx } from "../../projections.ts";
import { trail } from "./delivery.ts";

export async function delivery(ctx: MailCtx, input: { messageId?: string }): Promise<{ result: unknown }> {
  if (input.messageId === undefined) return bad(ctx, "messageId is needed: the message whose delivery you want.");
  return { result: await trail(ctx, { messageId: input.messageId }) };
}
