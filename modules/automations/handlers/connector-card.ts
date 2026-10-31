// A compact card in the chat while a connector is built: one title and a few rows, each done (a tick) or not. The test results and the review before publish are this card, so the person sees
// a short list instead of a paragraph. It is a checklist block posted as the agent; rows are cut and a secret-shaped row is refused, so a key never lands in a chat.
import { raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";
import { containsSecret } from "../trust.ts";

/** A key inside a sentence: a vendor prefix and a long tail, a Bearer header, a JWT. */
const KEY_IN_TEXT = /\b(?:sk|pk|rk|re|ghp|gho|xox[abprs])[-_][A-Za-z0-9_-]{16,}|Bearer\s+\S{12,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/;

type Item = { text?: unknown; done?: unknown };
type In = { threadId?: unknown; title?: unknown; items?: unknown };

const MAX_ROWS = 20;
const MAX_TEXT = 120;

export async function connectorCard(ctx: AutoCtx, input: In): Promise<{ messageId: string }> {
  const threadId = typeof input.threadId === "string" ? input.threadId : "";
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 80) : "";
  const rows = Array.isArray(input.items) ? (input.items as Item[]) : [];
  if (threadId === "" || title === "" || rows.length === 0) raise(ctx, "validation.bad_input", "A card needs a thread, a title and at least one row.");
  const items = rows.slice(0, MAX_ROWS).map((r) => ({ text: String(r.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT), done: r.done === true }));
  if (items.some((i) => i.text === "")) raise(ctx, "validation.bad_input", "Every row needs words.");
  if (containsSecret({ title, items }) || [title, ...items.map((i) => i.text)].some((x) => KEY_IN_TEXT.test(x))) raise(ctx, "validation.bad_input", "A card cannot hold a key or a secret.");
  if (!ctx.call) raise(ctx, "validation.precondition_failed", "This server cannot post a card here.");
  let sum = 0;
  for (const ch of `${threadId}${title}${items.map((i) => `${i.done ? 1 : 0}${i.text}`).join("|")}`) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  const out = (await ctx.call("chat.post", {
    threadId, body: title, blocks: [{ type: "checklist", v: 1, data: { title, items } }], idempotencyKey: `connector_card_${threadId}_${sum.toString(36)}_${ctx.now()}`,
  })) as { message?: { messageId?: string; id?: string } } | null;
  return { messageId: out?.message?.messageId ?? out?.message?.id ?? "" };
}
