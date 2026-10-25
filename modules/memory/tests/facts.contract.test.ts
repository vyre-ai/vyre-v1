// The thirty capabilities of memory against the frozen contract (ARCH 12.4): the handler table equals the manifest's capability list, each example input is a valid input,
// and every error a handler raises is one its capability declares.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { asPerson, codeOf, contractErrors, harness, seedFact } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "memory");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;

test("the handler table holds exactly the thirty-one frozen memory capabilities", () => {
  assert.equal(mine.length, 31);
  assert.deepEqual(Object.keys(h).sort(), mine.map((c) => c.name).sort());
});

test("each example input is a valid input", () => {
  for (const cap of mine) {
    assert.ok(cap.examples.length > 0, `${cap.name} has an example`);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(cap.name, "in", ex.input), [], `${cap.name}: example ${ex.name}`);
  }
});

const respond = {
  "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: "usr_boss" } }),
  "projects.get": () => ({ project: { folderId: "fld_harlow", lead: "usr_lead" } }),
};

interface Case { cap: string; run: (hn: Harness) => Promise<unknown>; code: string }
const cases: Case[] = [
  { cap: "memory.propose_fact", code: "validation.bad_input", run: (hn) => h["memory.propose_fact"]!(hn.ctx, { text: " ", sourceKind: "chat", sourceRef: "t" }) },
  { cap: "memory.fact.accept", code: "validation.bad_input", run: (hn) => h["memory.fact.accept"]!(hn.ctx, { factId: "fct_none" }) },
  { cap: "memory.fact.accept", code: "validation.precondition_failed", run: (hn) => h["memory.fact.accept"]!(hn.ctx, { factId: "fct_cur" }) },
  { cap: "memory.fact.reject", code: "validation.bad_input", run: (hn) => h["memory.fact.reject"]!(hn.ctx, { factId: "fct_cur" }) },
  { cap: "memory.fact.correct", code: "validation.bad_input", run: (hn) => h["memory.fact.correct"]!(hn.ctx, { factId: "fct_cur", text: "" }) },
  { cap: "memory.fact.get", code: "validation.not_found", run: (hn) => h["memory.fact.get"]!(hn.ctx, { factId: "fct_none" }) },
  { cap: "memory.facts.remove", code: "validation.bad_input", run: (hn) => h["memory.facts.remove"]!(hn.ctx, {}) },
  { cap: "memory.facts.remove", code: "permission.no_grant", run: (hn) => h["memory.facts.remove"]!(hn.ctx, { factIds: ["fct_omar"] }) },
  { cap: "memory.erase", code: "validation.bad_input", run: (hn) => h["memory.erase"]!(hn.ctx, {}) },
  { cap: "memory.erase", code: "permission.no_grant", run: (hn) => h["memory.erase"]!(asPerson(hn, { kind: "person", id: "usr_omar" }).ctx, { factIds: ["fct_cur"] }) },
  { cap: "memory.promote", code: "validation.bad_input", run: (hn) => h["memory.promote"]!(hn.ctx, { factId: "fct_cur", toLayer: "project" }) },
  { cap: "memory.promote", code: "permission.no_grant", run: (hn) => h["memory.promote"]!(asPerson(hn, { kind: "person", id: "usr_omar" }, { respond }).ctx, { factId: "fct_cur", toLayer: "space" }) },
  { cap: "memory.promotion.approve", code: "validation.bad_input", run: (hn) => h["memory.promotion.approve"]!(hn.ctx, { promotionId: "prm_none" }) },
  { cap: "memory.promotion.reject", code: "validation.bad_input", run: (hn) => h["memory.promotion.reject"]!(hn.ctx, { promotionId: "prm_none" }) },
  { cap: "memory.promotion.undo", code: "validation.bad_input", run: (hn) => h["memory.promotion.undo"]!(hn.ctx, { promotionId: "prm_none" }) },
  { cap: "memory.read_note", code: "validation.not_found", run: (hn) => h["memory.read_note"]!(hn.ctx, { noteId: "not_none" }) },
  { cap: "memory.versions", code: "validation.not_found", run: (hn) => h["memory.versions"]!(hn.ctx, { noteId: "not_none" }) },
  { cap: "memory.restore_version", code: "validation.not_found", run: (hn) => h["memory.restore_version"]!(hn.ctx, { noteId: "not_none", versionId: "ver_a" }) },
  { cap: "memory.find_by_subject", code: "permission.role_lacks_permission", run: (hn) => h["memory.find_by_subject"]!(hn.ctx, { subject: "rec_a" }) },
  { cap: "memory.search", code: "validation.bad_input", run: (hn) => h["memory.search"]!(hn.ctx, { q: " " }) },
  { cap: "memory.graph", code: "validation.bad_input", run: (hn) => h["memory.graph"]!(hn.ctx, { scope: "agent" }) },
  { cap: "memory.index_graph", code: "validation.bad_input", run: (hn) => h["memory.index_graph"]!(hn.ctx, { entity: "email", id: "x", seq: 1 }) },
  { cap: "memory.layout.save", code: "validation.bad_input", run: (hn) => h["memory.layout.save"]!(hn.ctx, { scope: "space", positions: { n: { x: Number.NaN, y: 0 } } }) },
];

test("every error a handler raises is one its capability declares", async () => {
  for (const c of cases) {
    const hn = harness({ respond });
    seedFact(hn, { id: "fct_cur", layer: "person", owner: "usr_dana", agentId: "agt_intake", text: "Dana likes tea" });
    seedFact(hn, { id: "fct_omar", layer: "person", owner: "usr_omar", agentId: "agt_intake", text: "Omar likes coffee" });
    const declared = mine.find((x) => x.name === c.cap)!.errors as readonly string[];
    await assert.rejects(() => c.run(hn), (e) => {
      assert.equal(codeOf(e), c.code, `${c.cap}`);
      assert.ok(declared.includes(codeOf(e)), `${c.cap} raised ${codeOf(e)}, which it does not declare`);
      return true;
    });
  }
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
