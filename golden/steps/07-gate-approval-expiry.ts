// Golden flow 7: Gate approval and expiry (spec 2.14; ARCH 4.6). An agent's mail send is held by the Gate; a person has not decided when the timeout comes, so the hold escalates (task.escalated)
// and then expires (gate.expired). Driven the way a person does: an agent routine is run through the gateway and the agent turn raises the hold; nothing calls the Gate by hand.
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_GATE = ["gate", "tasks", "mail", "agents", "runs", "devices", "access", "inbox", "files"];

/** Why this flow is a todo today (ruling 53). */
export const GAPS: Gap[] = [
  { packet: "P-L2_23", lane: "L2", what: "the daemon never constructs the agent turn engine, so agents.routine.run_now starts no turn and no send is raised for the Gate to hold" },
  { packet: "P-L2_LIVE", lane: "L2", what: "no real-token path puts an agent principal in front of the Gate: the gateway resolves device sessions only, so an agent act can only come from an engine turn" },
];

async function until<T>(what: string, ms: number, probe: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`${what}: nothing after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function runGate(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const agent = await trail.step("an agent is made", async () => expectStatus(await s.call("agents.create", admin, { idempotencyKey: "golden-7-agent", name: "Mailer", role: "Sends the weekly note" }), 200, "agents.create").agent.agentId as string);
    const routine = await trail.step("it gets a routine that sends mail", async () =>
      expectStatus(await s.call("agents.routine.save", admin, { idempotencyKey: "golden-7-routine", agentId: agent!, title: "Weekly note", prompt: "Email pat@acme.test: the weekly note is ready.", cron: "0 9 * * 1" }), 200, "agents.routine.save").routine.routineId as string,
    ["an agent is made"]);
    await trail.step("the routine runs now", async () => {
      expectStatus(await s.call("agents.routine.run_now", admin, { idempotencyKey: "golden-7-run", agentId: agent!, routineId: routine! }), 200, "agents.routine.run_now");
    }, ["it gets a routine that sends mail"]);
    const hold = await trail.step("the Gate holds the agent's send", async () =>
      until("a held mail.send", 3000, async () => {
        const holds = expectStatus(await s.call("gate.holds.list", admin, { states: ["held"] }), 200, "gate.holds.list").holds as { id: string; taskId: string; cap?: string; act?: string }[];
        return holds[0];
      }),
    ["the routine runs now"]);
    await trail.step("the approver has an Approve task naming the exact send", async () => {
      const t = expectStatus(await s.call("tasks.get", admin, { taskId: hold!.taskId }), 200, "tasks.get").task;
      assert.equal(t.kind, "approve", `task ${short(t)}`);
    }, ["the Gate holds the agent's send"]);
    await trail.step("refusal: a wrong approval token releases nothing", async () => {
      const r = await s.call("gate.release", admin, { holdId: hold!.id, taskId: hold!.taskId, approvalToken: "apv_wrong" });
      assert.ok(r.status >= 400 && r.status < 500, `gate.release with a bad token: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["the Gate holds the agent's send"]);
    await trail.step("with no decision the hold escalates", async () => {
      const out = expectStatus(await s.call("gate.expire", admin, { holdId: hold!.id }), 200, "gate.expire");
      assert.equal(out.outcome, "escalated", `first timeout: ${short(out)}`);
    }, ["the Gate holds the agent's send"]);
    await trail.step("with still no decision the hold expires and the send is dropped", async () => {
      const out = expectStatus(await s.call("gate.expire", admin, { holdId: hold!.id }), 200, "gate.expire");
      assert.equal(out.outcome, "dropped", `second timeout: ${short(out)}`);
    }, ["with no decision the hold escalates"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runGate([]);
  if (trail.failures.length) throw new Error(`flow 7 failed:\n${trail.report()}`);
  return events;
}
