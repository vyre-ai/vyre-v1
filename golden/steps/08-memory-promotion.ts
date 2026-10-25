// Golden flow 8: memory promotion (spec 2.15; ARCH 7.8). A member proposes a fact in their own layer, accepts it, and asks to promote it to the Space layer; they cannot edit that layer,
// so a task goes to the approver, who approves. Through the gateway, real tokens. Noah's session rows are what sign-in writes (the join path is flow 2's gap).
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_MEMORY = ["memory", "tasks", "devices", "access", "agents", "search"];

/** Why this flow is a todo today (ruling 53). Empty when every step passes. */
export const GAPS: Gap[] = [];

const TEXT = "Prefers email over phone calls";

export async function runMemory(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const noah = s.signedIn("usr_noah"), sana = s.signedIn("usr_sana");
    const fact = await trail.step("Noah proposes a fact in his own layer", async () => {
      const out = expectStatus(await s.call("memory.propose_fact", noah, { idempotencyKey: "golden-8-fact", layer: "person", agentId: "agt_scout", text: TEXT, sourceKind: "manual", sourceRef: "golden-8" }), 200, "memory.propose_fact");
      return { id: out.fact.factId as string, merged: out.merged as boolean };
    });
    await trail.step("the fact is accepted into current memory", async () => {
      if (!fact!.merged) expectStatus(await s.call("memory.fact.accept", noah, { factId: fact!.id }), 200, "memory.fact.accept");
      const got = expectStatus(await s.call("memory.fact.get", noah, { factId: fact!.id }), 200, "memory.fact.get");
      assert.equal(got.fact.text, TEXT);
    }, ["Noah proposes a fact in his own layer"]);
    await trail.step("another member cannot read it: it is Noah's alone", async () => {
      const r = await s.call("memory.fact.get", sana, { factId: fact!.id });
      assert.ok(r.status === 403 || r.status === 404, `Sana reading Noah's person-layer fact: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["Noah proposes a fact in his own layer"]);
    const promo = await trail.step("Noah asks to promote it to the Space layer", async () => {
      const out = expectStatus(await s.call("memory.promote", noah, { idempotencyKey: "golden-8-promote", factId: fact!.id, toLayer: "space", note: "Everyone should know this" }), 200, "memory.promote");
      assert.equal(out.promoted, false, "a member cannot edit the Space layer, so the promotion waits");
      assert.ok(out.taskId, `the request opened a task for the approver: ${short(out)}`);
      return { id: out.promotionId as string, taskId: out.taskId as string };
    }, ["the fact is accepted into current memory"]);
    await trail.step("refusal: Sana cannot approve the request", async () => {
      const r = await s.call("memory.promotion.approve", sana, { promotionId: promo!.id });
      assert.equal(r.status, 403, `memory.promotion.approve as Sana: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["Noah asks to promote it to the Space layer"]);
    await trail.step("the approver approves and the fact is in the Space layer", async () => {
      expectStatus(await s.call("memory.promotion.approve", admin, { promotionId: promo!.id }), 200, "memory.promotion.approve");
      const list = expectStatus(await s.call("memory.facts.list", sana, { layer: "space" }), 200, "memory.facts.list").facts as { text: string }[];
      assert.ok(list.some((f) => f.text === TEXT), `Sana now sees it in the Space layer: ${short(list)}`);
    }, ["Noah asks to promote it to the Space layer"]);
    await trail.step("Noah's own copy stays", async () => {
      const got = expectStatus(await s.call("memory.fact.get", noah, { factId: fact!.id }), 200, "memory.fact.get");
      assert.equal(got.fact.layer, "person");
    }, ["the approver approves and the fact is in the Space layer"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runMemory([]);
  if (trail.failures.length) throw new Error(`flow 8 failed:\n${trail.report()}`);
  return events;
}
