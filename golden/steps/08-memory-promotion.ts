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
    // Noah is a member and holds edit on the Space, so his own approval is enough for the Space layer (spec 2.15: no admin needed when the person can edit the target).
    // Both paths emit memory.promotion_requested then memory.promoted; the approver path is runMemoryApproval below.
    await trail.step("Noah promotes it to the Space layer", async () => {
      const out = expectStatus(await s.call("memory.promote", noah, { idempotencyKey: "golden-8-promote", factId: fact!.id, toLayer: "space", note: "Everyone should know this" }), 200, "memory.promote");
      assert.equal(out.promoted, true, `promotion ${short(out)}`);
    }, ["the fact is accepted into current memory"]);
    await trail.step("Sana now sees it in the Space layer", async () => {
      const list = expectStatus(await s.call("memory.facts.list", sana, { layer: "space" }), 200, "memory.facts.list").facts as { text: string }[];
      assert.ok(list.some((f) => f.text === TEXT), `Space layer ${short(list)}`);
    }, ["Noah promotes it to the Space layer"]);
    await trail.step("Noah's own copy stays in his layer", async () => {
      const got = expectStatus(await s.call("memory.fact.get", noah, { factId: fact!.id }), 200, "memory.fact.get");
      assert.equal(got.fact.layer, "person");
    }, ["Noah promotes it to the Space layer"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

/** The approver path: a promotion into a layer Noah cannot edit waits as a task for its owner. Helper is Mia's agent. */
export const APPROVAL_GAPS: Gap[] = [
  { packet: "P-GF_10", lane: "L7", what: "Mia makes Helper through agents.create (so it has its Agents folder) and still answers 403 on memory.promotion.approve: owning the agent gives no edit on its folder, so memory access (modules/memory/projections.ts makeAccess, authorize edit on agent.folderId) denies the owner" },
];

export async function runMemoryApproval(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const noah = s.signedIn("usr_noah"), sana = s.signedIn("usr_sana"), mia = s.signedIn("usr_mia");
    // The core seed's agt_helper is a kernel resource with no row in the agents module, so it has no folder to edit. Mia makes the agent through agents.create, which gives it its Agents folder.
    const helper = await trail.step("Mia makes Helper and owns it", async () => {
      const out = expectStatus(await s.call("agents.create", mia, { idempotencyKey: "golden-8b-helper", name: "Helper", role: "Golden flow helper" }), 200, "agents.create");
      return out.agent.id as string;
    });
    const fact = await trail.step("Noah proposes and accepts a fact", async () => {
      const out = expectStatus(await s.call("memory.propose_fact", noah, { idempotencyKey: "golden-8b-fact", layer: "person", agentId: "agt_scout", text: TEXT, sourceKind: "manual", sourceRef: "golden-8b" }), 200, "memory.propose_fact");
      if (!out.merged) expectStatus(await s.call("memory.fact.accept", noah, { factId: out.fact.factId }), 200, "memory.fact.accept");
      return out.fact.factId as string;
    }, ["Mia makes Helper and owns it"]);
    const promo = await trail.step("Noah asks to promote it to Helper's memory and a task waits", async () => {
      const out = expectStatus(await s.call("memory.promote", noah, { idempotencyKey: "golden-8b-promote", factId: fact!, toLayer: "agent", agentId: helper! }), 200, "memory.promote");
      assert.equal(out.promoted, false);
      assert.ok(out.taskId, `a task for the approver: ${short(out)}`);
      return out.promotionId as string;
    }, ["Noah proposes and accepts a fact"]);
    await trail.step("refusal: Sana cannot approve the request", async () => {
      const r = await s.call("memory.promotion.approve", sana, { promotionId: promo! });
      assert.equal(r.status, 403, `memory.promotion.approve as Sana: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["Noah asks to promote it to Helper's memory and a task waits"]);
    await trail.step("Mia, Helper's owner, approves and the fact is in Helper's layer", async () => {
      expectStatus(await s.call("memory.promotion.approve", mia, { promotionId: promo! }), 200, "memory.promotion.approve");
      const list = expectStatus(await s.call("memory.facts.list", mia, { layer: "agent", agentId: helper! }), 200, "memory.facts.list").facts as { text: string }[];
      assert.ok(list.some((f) => f.text === TEXT), `Helper's layer ${short(list)}`);
    }, ["Noah asks to promote it to Helper's memory and a task waits"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runMemory([]);
  if (trail.failures.length) throw new Error(`flow 8 failed:\n${trail.report()}`);
  return events;
}
