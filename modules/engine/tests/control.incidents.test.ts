// AI incidents (spec 3.10): open, assign, note, resolve, list. People report one; the system opens them for label denials, scrub misses and runaway spend.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { incidentAssign, incidentGet, incidentNote, incidentOpen, incidentResolve, incidentsList, openIncident } from "../handlers/control.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";

test("an incident goes from open to assigned to resolved, with its notes, and every answer fits the contract", () => {
  const h = harness();
  const opened = incidentOpen(h.ctx, { kind: "person_report", title: "Intake quoted a fee we do not charge", agentId: "agt_intake", turnId: "trn_abc123", note: "Client saw it in the chat." });
  assert.deepEqual(contractErrors("engine.incident.open", "out", opened), []);
  const id = opened.incident.incidentId;
  assert.match(id, /^inc_[a-z0-9]+$/);
  assert.equal(opened.incident.state, "open");
  assert.equal(opened.incident.agentId, "agt_intake");
  assert.deepEqual(opened.incident.notes.map((n) => [n.by, n.text]), [["usr_dana", "Client saw it in the chat."]]);
  assert.deepEqual(h.named("incident.opened")[0]?.payload, { incidentId: id, kind: "person_report" });

  h.advance(60_000);
  const assigned = incidentAssign(h.ctx, { incidentId: id, ownerId: "usr_sam" });
  assert.deepEqual(contractErrors("engine.incident.assign", "out", assigned), []);
  assert.equal(assigned.incident.state, "assigned");
  assert.equal(assigned.incident.ownerId, "usr_sam");
  assert.deepEqual(h.named("incident.assigned")[0]?.payload, { incidentId: id, ownerId: "usr_sam" });

  const noted = incidentNote(h.ctx, { incidentId: id, text: "Reproduced with the same prompt." });
  assert.equal(noted.incident.notes.length, 2);
  assert.equal(noted.incident.state, "assigned", "a note changes nothing else");
  assert.throws(() => incidentNote(h.ctx, { incidentId: id, text: "  " }), (e) => codeOf(e) === "validation.bad_input");

  h.advance(60_000);
  assert.throws(() => incidentResolve(h.ctx, { incidentId: id, note: "" }), (e) => codeOf(e) === "validation.bad_input", "say what was done");
  const resolved = incidentResolve(h.ctx, { incidentId: id, note: "Prompt fixed; fee table added to the agent's notes." });
  assert.deepEqual(contractErrors("engine.incident.resolve", "out", resolved), []);
  assert.equal(resolved.incident.state, "resolved");
  assert.equal(resolved.incident.resolvedAt, h.clock.t);
  assert.equal(resolved.incident.notes.length, 3);
  assert.deepEqual(h.named("incident.resolved")[0]?.payload, { incidentId: id, by: "usr_dana" });
  assert.equal(incidentResolve(h.ctx, { incidentId: id, note: "again" }).incident.notes.length, 3, "resolving twice changes nothing");
  assert.equal(h.named("incident.resolved").length, 1);
  assert.throws(() => incidentAssign(h.ctx, { incidentId: id, ownerId: "usr_kim" }), (e) => codeOf(e) === "validation.precondition_failed");

  const got = incidentGet(h.ctx, { incidentId: id });
  assert.deepEqual(contractErrors("engine.incident.get", "out", got), []);
  assert.deepEqual(got.incident.notes.map((n) => n.text), ["Client saw it in the chat.", "Reproduced with the same prompt.", "Prompt fixed; fee table added to the agent's notes."]);
  assert.throws(() => incidentGet(h.ctx, { incidentId: "inc_missing" }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(assertEventsConform(h), []);
});

test("incidents list newest first, filter by state, and page", () => {
  const h = harness();
  const ids: string[] = [];
  for (const [i, kind] of (["scrub_miss", "label_denied", "runaway_spend"] as const).entries()) {
    h.advance(1000);
    ids.push(openIncident(h.ctx, { kind, title: `incident ${i}` }).incidentId);
  }
  incidentAssign(h.ctx, { incidentId: ids[0]!, ownerId: "usr_sam" });
  incidentResolve(h.ctx, { incidentId: ids[1]!, note: "fine" });

  const all = incidentsList(h.ctx, {});
  assert.deepEqual(all.incidents.map((i) => i.title), ["incident 2", "incident 1", "incident 0"]);
  assert.equal(all.total, 3);
  assert.deepEqual(contractErrors("engine.incidents.list", "out", all), []);
  assert.deepEqual(incidentsList(h.ctx, { state: ["open"] }).incidents.map((i) => i.title), ["incident 2"]);
  assert.deepEqual(incidentsList(h.ctx, { state: ["assigned", "resolved"] }).incidents.map((i) => i.title), ["incident 1", "incident 0"]);

  const first = incidentsList(h.ctx, { limit: 2 });
  assert.deepEqual(first.incidents.map((i) => i.title), ["incident 2", "incident 1"]);
  assert.equal(first.next, "2");
  const second = incidentsList(h.ctx, { limit: 2, cursor: first.next as string });
  assert.deepEqual(second.incidents.map((i) => i.title), ["incident 0"]);
  assert.equal(second.next, undefined);
});

test("the system opens an incident for itself and a title is required", () => {
  const h = harness({ principal: { kind: "service", id: "svc_engine" } });
  const made = openIncident(h.ctx, { kind: "runaway_spend", title: "Intake spent 90 percent of its day in one run", agentId: "agt_intake" });
  assert.equal(made.state, "open");
  assert.throws(() => incidentOpen(h.ctx, { kind: "other", title: "   " }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.named("incident.opened").length, 1);
});

test("the handler table covers the incident capabilities", () => {
  for (const name of ["engine.incidents.list", "engine.incident.get", "engine.incident.open", "engine.incident.assign", "engine.incident.resolve", "engine.incident.note"]) {
    assert.equal(typeof handlers[name], "function", name);
  }
});
