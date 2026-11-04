// Editing a held message (lane l-chrome2a): the hold carries who, how and what in a person's words; the person who handles it rewrites the words, the approval is bound to the new ones, the card says it was
// edited by them, and approving sends the edited text. The agent cannot edit, a held act that is not a message cannot be edited, and an approval given before the edit no longer opens it.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, as, bob, bot, parkInput } from "../fixtures/seed.ts";
import { bindPayloadHash } from "../../../lib/payload-hasher.ts";
import { findHold } from "../projections.ts";

const DM = { to: "usr_bob", body: "Hi **Bob**,\n\n- one\n- two", timing: "online" };
const hashOf = (cap: string, v: number, input: unknown, principal: { id: string }, actingFor: string | undefined): string => `h:${cap}:${v}:${JSON.stringify(input)}:${principal.id}:${actingFor ?? ""}`;

async function parked(h: Harness, over: Record<string, unknown> = {}) {
  const input = parkInput({ capName: "chat.message_person", input: DM, ...over });
  input["payloadHash"] = hashOf(String(input["capName"]), 1, input["input"], input["principal"] as { id: string }, input["actingFor"] as string | undefined);
  return { input, p: (await h.call("gate.park", input, as(bot))) as { holdId: string; taskId: string } };
}
const person = (p: { id: string }) => ({ id: p.id, kind: "person" as const, device: "dev_1" });

test("a held message's card carries who, how and what, in a person's words, and the raw call beside it", async () => {
  const h = harness();
  await parked(h);
  const block = (h.callsTo("tasks.create")[0]!.input.blocks as Array<{ data: Record<string, any> }>)[0]!.data;
  assert.deepEqual(block["outward"], { channel: "message", to: [{ kind: "person", id: "usr_bob" }], body: DM.body, bodyField: "body", schedule: { kind: "online" } });
  assert.equal(block["cap"], "chat.message_person");
  assert.deepEqual(block["input"], DM, "the exact act that was held is still there");
});

test("the person who handles it rewrites the words: the stored call, the hash and the card change together, and the card says who edited", async () => {
  bindPayloadHash(hashOf);
  try {
    const h = harness();
    h.callee("tasks.held_revise", () => ({ ok: true }));
    const { p } = await parked(h);
    const r = await h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body: "Hi Bob, short version." }, person(alice));
    assert.equal(r.ok, true);
    const call = h.callsTo("tasks.held_revise")[0]!.input as { taskId: string; payloadHash: string; blocks: Array<{ data: Record<string, any> }> };
    assert.equal(call.taskId, p.taskId);
    assert.equal(call.payloadHash, hashOf("chat.message_person", 1, { ...DM, body: "Hi Bob, short version." }, bot, alice.id), "the approval is bound to the new words, as the same caller and the person it acts for");
    assert.equal(call.blocks[0]!.data["outward"].body, "Hi Bob, short version.");
    assert.equal(call.blocks[0]!.data["outward"].edited.by, alice.id);
    assert.deepEqual(call.blocks[0]!.data["input"], { ...DM, body: "Hi Bob, short version." });
    const stored = findHold(h.ctxFor(null, { id: alice.id, kind: "person" }).db, p.holdId)!;
    assert.deepEqual(stored.input, { ...DM, body: "Hi Bob, short version." });
    assert.equal(stored.payloadHash, call.payloadHash);
    assert.equal(h.events.find((e) => e.name === "gate.revised")?.payload["by"], alice.id);
    assert.ok(String(h.events.find((e) => e.name === "gate.revised")?.payload["was"]).length > 0 && String(h.events.find((e) => e.name === "gate.revised")?.payload["now"]).length > 0, "the audit log keeps the original and the revised words");
  } finally { bindPayloadHash(null); }
});

test("approving after the edit sends the edited words, and an approval given before the edit no longer opens it", async () => {
  bindPayloadHash(hashOf);
  try {
    const h = harness();
    h.callee("tasks.held_revise", () => ({ ok: true }));
    h.callee("chat.message_person", () => ({ state: "sent" }));
    const { input, p } = await parked(h);
    const claims = (hash: unknown) => h.sealToken({ task: p.taskId, hold: p.holdId, decision: "dec_1", hash, by: alice.id, forPerson: null, device: "dev_1", exp: h.now() + 600_000 });
    const early = claims(input["payloadHash"]);
    await h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body: "Edited words." }, person(alice));
    await assert.rejects(h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: early }, person(alice)), (e) => { assert.equal(reasonOf(e), "token_mismatch"); return true; });
    const fresh = claims(hashOf("chat.message_person", 1, { ...DM, body: "Edited words." }, bot, alice.id));
    await h.call("gate.release", { holdId: p.holdId, taskId: p.taskId, approvalToken: fresh }, person(alice));
    assert.equal((h.callsTo("chat.message_person")[0]!.input as { body: string }).body, "Edited words.", "what went out is what was edited");
  } finally { bindPayloadHash(null); }
});

test("refused: the agent, someone who does not handle it, a held act that is not a message, empty words, a hold already decided", async () => {
  bindPayloadHash(hashOf);
  try {
    const h = harness({ authorize: () => false });
    h.callee("tasks.held_revise", () => ({ ok: true }));
    const { p } = await parked(h);
    const rev = (who: object, body = "x") => h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body }, who as never);
    await assert.rejects(rev(as(bot)), (e) => codeOf(e) === "permission.no_grant");
    await assert.rejects(rev(person(bob)), (e) => codeOf(e) === "permission.no_grant");
    await assert.rejects(rev(person(alice), "   "), (e) => reasonOf(e) === "empty");
    const other = await parked(h, { capName: "files.write", input: { fileId: "fil_1", content: { text: "x" } }, act: "approve", decisionId: "dec_2" });
    await assert.rejects(h.call("gate.holds.revise", { holdId: other.p.holdId, taskId: other.p.taskId, body: "y" }, person(alice)), (e) => reasonOf(e) === "not_a_message");
    await h.call("gate.deny", { holdId: p.holdId, taskId: p.taskId, mode: "drop" }, person(alice));
    await assert.rejects(rev(person(alice)), (e) => reasonOf(e) === "not_held");
    assert.equal(h.callsTo("tasks.held_revise").length, 0, "nothing was rewritten");
  } finally { bindPayloadHash(null); }
});

test("an email is edited in its text and loses its HTML; a refused card rewrite leaves the hold as it was", async () => {
  bindPayloadHash(hashOf);
  try {
    const h = harness();
    const mail = { mailboxId: "mbx_1", to: [{ address: "aliza@example.com" }], subject: "Deed", text: "old", html: "<p>old</p>" };
    const { p } = await parked(h, { capName: "mail.send", input: mail });
    h.callee("tasks.held_revise", () => { throw new Error("the task refused"); });
    await assert.rejects(h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body: "new" }, person(alice)));
    assert.deepEqual(findHold(h.ctxFor(null, { id: alice.id, kind: "person" }).db, p.holdId)!.input, mail, "unchanged");
    h.callee("tasks.held_revise", () => ({ ok: true }));
    await h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body: "new" }, person(alice));
    assert.deepEqual(findHold(h.ctxFor(null, { id: alice.id, kind: "person" }).db, p.holdId)!.input, { mailboxId: "mbx_1", to: [{ address: "aliza@example.com" }], subject: "Deed", text: "new" });
  } finally { bindPayloadHash(null); }
});

test("a calendar event's title and agenda can be edited, its agenda may be empty, and the invitees and time stay as they were", async () => {
  bindPayloadHash(hashOf);
  try {
    const h = harness();
    h.callee("tasks.held_revise", () => ({ ok: true }));
    const ev = { connectionId: "con_1", calendarId: "primary", summary: "Prep", description: "Old agenda", attendees: [{ email: "a@b.c" }], start: { dateTime: "2026-11-04T14:00:00Z" }, end: { dateTime: "2026-11-04T15:00:00Z" }, idempotencyKey: "k" };
    const { p } = await parked(h, { capName: "google.calendar.create_event", input: ev, decisionId: "dec_ev" });
    const r = await h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body: "", title: "Prep, moved" }, person(alice));
    assert.equal(r.ok, true);
    const call = h.callsTo("tasks.held_revise")[0]!.input as { blocks: Array<{ data: Record<string, any> }> };   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(call.blocks[0]!.data["input"], { ...ev, summary: "Prep, moved", description: "" });
    assert.equal(call.blocks[0]!.data["outward"].event.title, "Prep, moved");
    await assert.rejects(h.call("gate.holds.revise", { holdId: p.holdId, taskId: p.taskId, body: "x", title: " " }, person(alice)), (e) => reasonOf(e) === "empty_title");
  } finally { bindPayloadHash(null as never); }
});
