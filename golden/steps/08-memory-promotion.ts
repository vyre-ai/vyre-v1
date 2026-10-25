// Golden flow 8: memory promotion (spec 2.15; ARCH 7.8). A member proposes a fact in their own layer, accepts it, and asks to promote it to an agent's layer; when they cannot edit that layer
// a task goes to the approver, who approves. Through the gateway, real tokens. Noah's session rows are what sign-in writes (the join path is flow 2's gap).
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
    const noah = s.signedIn("usr_noah"), sana = s.signedIn("usr_sana"), mia = s.signedIn("usr_mia");   // Mia owns the Helper agent, so she is its approver
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
    // Helper is Mia's agent: Noah is a member who may not edit its memory, so the request goes to an approver. If the seed lets him edit it, the promotion applies at once (both paths emit the same events).
    const promo = await trail.step("Noah asks to promote it to Helper's memory", async () => {
      const out = expectStatus(await s.call("memory.promote", noah, { idempotencyKey: "golden-8-promote", factId: fact!.id, toLayer: "agent", agentId: "agt_helper", note: "Helper should know this" }), 200, "memory.promote");
      if (!out.promoted) assert.ok(out.taskId, `the request opened a task for the approver: ${short(out)}`);
      return { id: out.promotionId as string, promoted: out.promoted as boolean };
    }, ["the fact is accepted into current memory"]);
    await trail.step("refusal: Sana cannot approve the request", async () => {
      if (promo!.promoted) return;
      const r = await s.call("memory.promotion.approve", sana, { promotionId: promo!.id });
      assert.equal(r.status, 403, `memory.promotion.approve as Sana: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["Noah asks to promote it to Helper's memory"]);
    await trail.step("the approver approves", async () => {
      if (promo!.promoted) return;
      expectStatus(await s.call("memory.promotion.approve", mia, { promotionId: promo!.id }), 200, "memory.promotion.approve");
    }, ["Noah asks to promote it to Helper's memory"]);
    await trail.step("the fact is in Helper's layer and Noah's own copy stays", async () => {
      const list = expectStatus(await s.call("memory.facts.list", mia, { layer: "agent", agentId: "agt_helper" }), 200, "memory.facts.list").facts as { text: string }[];
      assert.ok(list.some((f) => f.text === TEXT), `Helper's layer lists it: ${short(list)}`);
      const got = expectStatus(await s.call("memory.fact.get", noah, { factId: fact!.id }), 200, "memory.fact.get");
      assert.equal(got.fact.layer, "person");
    }, ["the approver approves"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runMemory([]);
  if (trail.failures.length) throw new Error(`flow 8 failed:\n${trail.report()}`);
  return events;
}
