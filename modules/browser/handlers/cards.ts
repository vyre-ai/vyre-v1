// The Chrome cards of a chat (manifests/browser.ts): post one, and what the buttons on one do. The person's own Chrome is reached through the one port the daemon binds (lib/personal-chrome.ts); where no
// daemon with the extension runs this, nothing here can act and the buttons say so.
import { cleanBlock } from "../../../lib/chrome-cards.ts";
import { personalChrome } from "../../../lib/personal-chrome.ts";
import { raise } from "../projections.ts";
import type { BrowserCtx } from "../projections.ts";

export async function cardsPost(ctx: BrowserCtx, input: { threadId: string; block: { type: string; data: unknown }; idempotencyKey: string }) {
  const block = cleanBlock(input.block.type, input.block.data);
  if (!block) raise(ctx.trace.traceId, "validation.bad_input", "That is not a card for work in the person's Chrome.");
  // no text and no mention: a card is never a message to an agent
  await ctx.call("chat.post", { threadId: input.threadId, body: "", mentions: [], idempotencyKey: input.idempotencyKey, blocks: [{ type: block!.type, v: 1, data: block!.data }] });
  return { posted: true };
}

export async function chromeAct(ctx: BrowserCtx, input: { action: "send" | "drop" | "watch" | "takeover"; agentId: string; heldId?: string; reason?: string; edits?: { to?: string; subject?: string; message?: string }; threadId?: string; summary?: string; idempotencyKey: string }) {
  const trace = ctx.trace.traceId;
  if (ctx.principal.kind !== "person") raise(trace, "permission.no_grant", "Only the person whose Chrome it is can press these.");
  const port = personalChrome();
  if (!port || !(await port.available({ space: ctx.space, person: ctx.principal.id }))) raise(trace, "provider.unavailable", "Your Chrome is not open to agents on this computer. Open Vyre for Chrome here, or press it on the computer where your Chrome is.");
  const p = port!;
  if ((input.action === "send" || input.action === "drop") && !input.heldId) raise(trace, "validation.bad_input", "Say which held item.");
  switch (input.action) {
    case "send": {
      try {
        const out = await p.call({ tool: "chrome_send", args: { heldId: input.heldId, ...(input.edits ? { edits: input.edits } : {}) }, agent: { id: input.agentId, name: input.agentId }, space: ctx.space, ...(input.threadId ? { thread: input.threadId } : {}), timeoutMs: 60_000 });
        return { done: out["sent"] === true };
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (code === "held_gone") return { done: false, already: true };
        raise(trace, code === "offline" || code === "timeout" ? "provider.unavailable" : "validation.bad_input", e instanceof Error ? e.message : "Chrome did not answer.");
      }
      return { done: false };
    }
    case "drop": {
      p.drop(input.heldId as string);
      if (input.threadId) await ctx.call("chat.post", { threadId: input.threadId, body: `Don't send that.${input.summary ? ` (${input.summary.slice(0, 200)})` : ""}${input.reason && input.reason.trim() ? ` ${input.reason.trim().slice(0, 500)}` : " Ask me what to change."}`, mentions: [], idempotencyKey: `chrdrop:${input.heldId}` });
      return { done: true };
    }
    case "watch": p.watch(input.agentId); return { done: true };
    default: p.takeOver(input.agentId); return { done: true };
  }
}
