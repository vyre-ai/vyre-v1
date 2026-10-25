// The twenty-three lifecycle, recording, screenshot, live view and timeline capabilities of P-L2_16 against the frozen contract (ARCH 12.4): the handler table holds only frozen computers
// capabilities, each example input is valid, and every error a handler raises is one its capability declares. The 35 Chrome, Screen and Files tools are tools.contract.test.ts (P-L2_16b).
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { bindHost } from "../projections.ts";
import { asPerson, codeOf, contractErrors, harness, INTAKE, OMAR } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "computers");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const OURS = [
  "computers.list", "computers.get", "computers.provision", "computers.configure", "computers.remove", "computers.wake", "computers.sleep", "computers.take_over", "computers.give_back",
  "computers.health", "computers.sessions.list", "computers.session.sign_out", "computers.record_start", "computers.record_stop", "computers.recordings.list", "computers.recording.get",
  "computers.recording.process", "computers.recording.delete", "computers.screenshot", "computers.stream", "computers.timeline", "computers.timeline_step", "computers.skill_from_step",
];

test("the handler table holds the twenty-three lifecycle capabilities and the 35 tools: all 58 frozen computers capabilities, nothing else", () => {
  assert.equal(mine.length, 58);
  assert.deepEqual(Object.keys(h).sort(), mine.map((c) => c.name).sort());
  for (const name of OURS) assert.ok(h[name], name);
});

test("each example input is a valid input", () => {
  for (const name of OURS) {
    const cap = mine.find((c) => c.name === name)!;
    assert.ok(cap.examples.length > 0, `${name} has an example`);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example ${ex.name}`);
  }
});

interface Case { cap: string; code: string; run: (hn: Harness, id: string) => Promise<unknown>; hn?: () => Harness }
const NONE = "cmt_none";
const cases: Case[] = [
  { cap: "computers.get", code: "validation.not_found", run: (hn) => h["computers.get"]!(hn.ctx, { computerId: NONE }) },
  { cap: "computers.provision", code: "validation.duplicate", run: (hn) => h["computers.provision"]!(hn.ctx, { agentId: INTAKE, idempotencyKey: "k2" }) },
  { cap: "computers.provision", code: "validation.bad_input", hn: () => harness({ respond: { "agents.get": () => { throw new Error("none"); } } }), run: (hn) => h["computers.provision"]!(hn.ctx, { agentId: "agt_x", idempotencyKey: "k" }) },
  { cap: "computers.provision", code: "permission.needs_team", hn: () => harness({ personalSpace: true }), run: (hn) => h["computers.provision"]!(hn.ctx, { agentId: INTAKE, idempotencyKey: "k" }) },
  { cap: "computers.configure", code: "validation.bad_input", run: (hn, id) => h["computers.configure"]!(hn.ctx, { computerId: id }) },
  { cap: "computers.remove", code: "validation.not_found", run: (hn) => h["computers.remove"]!(hn.ctx, { computerId: NONE }) },
  { cap: "computers.wake", code: "validation.not_found", run: (hn) => h["computers.wake"]!(hn.ctx, { computerId: NONE }) },
  { cap: "computers.sleep", code: "validation.precondition_failed", run: async (hn, id) => { await h["computers.take_over"]!(hn.ctx, { computerId: id }); await h["computers.sleep"]!(hn.ctx, { computerId: id }); } },
  { cap: "computers.take_over", code: "validation.precondition_failed", run: async (hn, id) => { await h["computers.take_over"]!(hn.ctx, { computerId: id }); await h["computers.take_over"]!(asPerson(hn, { kind: "person", id: OMAR }).ctx, { computerId: id }); } },
  { cap: "computers.take_over", code: "permission.no_grant", run: (hn, id) => h["computers.take_over"]!(asPerson(hn, { kind: "agent", id: INTAKE }).ctx, { computerId: id }) },
  { cap: "computers.give_back", code: "permission.no_grant", run: async (hn, id) => { await h["computers.take_over"]!(hn.ctx, { computerId: id }); await h["computers.give_back"]!(asPerson(hn, { kind: "person", id: OMAR }, { manager: false }).ctx, { computerId: id }); } },
  { cap: "computers.record_start", code: "validation.precondition_failed", run: (hn, id) => h["computers.record_start"]!(hn.ctx, { computerId: id }) },
  { cap: "computers.record_stop", code: "validation.bad_input", run: (hn, id) => h["computers.record_stop"]!(hn.ctx, { computerId: id }) },
  { cap: "computers.recording.get", code: "validation.bad_input", run: (hn) => h["computers.recording.get"]!(hn.ctx, { recordingId: "rcd_none" }) },
  { cap: "computers.recording.process", code: "validation.bad_input", run: (hn) => h["computers.recording.process"]!(hn.ctx, { recordingId: "rcd_none", intents: ["make_skill"], idempotencyKey: "k" }) },
  { cap: "computers.screenshot", code: "validation.bad_input", run: (hn, id) => h["computers.screenshot"]!(hn.ctx, { computerId: id }) },
  { cap: "computers.stream", code: "validation.bad_input", run: (hn, id) => h["computers.stream"]!(hn.ctx, { computerId: id }) },
  { cap: "computers.timeline_step", code: "validation.not_found", run: (hn, id) => h["computers.timeline_step"]!(hn.ctx, { computerId: id, stepId: "stp_none" }) },
  { cap: "computers.skill_from_step", code: "validation.not_found", run: (hn, id) => h["computers.skill_from_step"]!(hn.ctx, { computerId: id, stepId: "stp_none", idempotencyKey: "k" }) },
  { cap: "computers.session.sign_out", code: "validation.bad_input", run: (hn, id) => h["computers.session.sign_out"]!(hn.ctx, { computerId: id, site: " " }) },
  { cap: "computers.list", code: "permission.needs_team", hn: () => harness({ personalSpace: true }), run: (hn) => h["computers.list"]!(hn.ctx, {}) },
];

test("every error a handler raises is one its capability declares", async () => {
  for (const c of cases) {
    const hn = c.hn ? c.hn() : harness();
    const made = c.hn ? null : await h["computers.provision"]!(hn.ctx, { agentId: INTAKE, idempotencyKey: "k1" });
    const declared = mine.find((x) => x.name === c.cap)!.errors as readonly string[];
    await assert.rejects(() => c.run(hn, made?.computer.computerId ?? NONE), (e) => {
      assert.equal(codeOf(e), c.code, c.cap);
      assert.ok(declared.includes(codeOf(e)), `${c.cap} raised ${codeOf(e)}, which it does not declare`);
      return true;
    });
  }
  bindHost(null);
});
