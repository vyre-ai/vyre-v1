// Test helpers: call a handler by name, read the error code of a refused call, build a launched campaign in one line, and feed events to the consumers.

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { advance, handlers } from "../impl.ts";
import type { ProjTx } from "../projections.ts";
import { consumers } from "../projections.ts";
import { projEvent } from "./world.ts";
import type { World } from "./world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
export type Cap = keyof typeof handlers;

export async function run<T>(ctx: Ctx, cap: Cap, input: unknown): Promise<T> {
  return (await (handlers[cap] as Fn)(ctx, input)) as T;
}

export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

export const EMAIL_STEP = { key: "hello", type: "email", config: { mailboxId: "mbx_sales", subject: "Hello {{first_name}}", text: "Hi {{first_name}}, a note about your matter." } };

export interface Built { campaignId: string }

/** Create a campaign, give it steps and an audience of the contacts already in the world, and leave it a draft. */
export async function build(w: World, o: { kind?: string; steps?: unknown[]; name?: string; windows?: unknown; throttle?: number; stopOnReply?: boolean; audience?: boolean } = {}): Promise<Built> {
  const made = await run<{ campaign: { campaignId: string } }>(w.ctx, "campaigns.create", { name: o.name ?? "Spring outreach", kind: o.kind ?? "sequence" });
  const campaignId = made.campaign.campaignId;
  await run(w.ctx, "campaigns.steps_set", { campaignId, steps: o.steps ?? [EMAIL_STEP] });
  if (o.windows !== undefined || o.throttle !== undefined || o.stopOnReply !== undefined) {
    await run(w.ctx, "campaigns.schedule_set", { campaignId, windows: o.windows ?? { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59", tz: "UTC" }, ...(o.throttle !== undefined ? { throttlePerHour: o.throttle } : {}), stopOnReply: o.stopOnReply ?? true });
  }
  if (o.audience !== false) await run(w.ctx, "campaigns.audience_set", { campaignId, type: "contact" });
  return { campaignId };
}

export async function launch(w: World, campaignId: string): Promise<{ runId: string }> {
  return run(w.ctx, "campaigns.launch", { campaignId });
}

/** One engine pass, as the scheduler's tick would run it. */
export const pass = (w: World, campaignId: string) => advance(w.ctx, campaignId);

type On = Record<string, (tx: ProjTx, e: ReturnType<typeof projEvent>) => void>;

/** Deliver an event to the consumer that listens for it, the way the event log would. */
export function deliver(w: World, event: string, payload: Record<string, unknown>): void {
  for (const c of Object.values(consumers)) {
    const on = (c.on as On)[event];
    if (on) on(w.db, projEvent(payload, w.now()));
  }
}

/** The unsubscribe link inside a sent email. */
export function unsubscribeToken(text: string): string {
  const m = /\/u\/([A-Za-z0-9_-]+)/.exec(text);
  if (!m || !m[1]) throw new Error("no unsubscribe link in the email");
  return m[1];
}
