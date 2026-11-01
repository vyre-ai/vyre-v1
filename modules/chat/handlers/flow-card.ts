// chat.flow_card (rc.9, "Describe a Flow in chat"): the card a drafted Flow leaves in the thread it was drafted in. Written here, by a host handler, because its buttons call something (Turn on, Test) and only
// a host handler may write such a button (a card that arrives by chat.post has its buttons made inert). The handler reads the draft itself as the caller, so the words come from the definition and the buttons
// can only turn on or test that one draft: nothing in the card is the caller's to choose.
import { describeFlow } from "../../../lib/describe-flow.ts";
import { registry } from "../../../generated/registry.ts";
import { ensure, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

export async function flowCard(ctx: ChatCtx, input: { threadId: string; automationId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Automations are not available just now.");
  const got = (await ctx.call("automations.get", { automationId: input.automationId })) as { automation?: { id: string; name: string; status: string; definition: { triggers: { key: string }[]; nodes: { id: string; key: string }[] } } };
  const a = got.automation;
  if (!a) raise(ctx, "validation.not_found", "That Flow is not here.");
  if (a!.status !== "draft") raise(ctx, "validation.bad_input", "Only a draft Flow gets a card; this one is already running.");
  const m = postLinkCard(ctx, t.id, {
    icon: "flow", lead: "Flow drafted", title: a!.name, body: describeFlow(a!.definition, registry).join("\n"), target: { type: "automation", id: a!.id },
    actions: [
      { key: "on", label: "Turn on", cap: "automations.set_enabled", input: { automationId: a!.id, enabled: true } },
      { key: "test", label: "Test", cap: "automations.test", input: { automationId: a!.id } },
    ],
  } as never, `Flow drafted: ${a!.name}`);
  return { messageId: m.id };
}
