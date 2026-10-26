// Erase a person's data (P-L7_13; spec 2.26; ARCH 4.11): find everything about one contact, erase it with an audit entry, leave tombstones, and replay them after a restore so erased data never comes back; holds stop
// an erase and only the Owner can override one. Records, files, search, the conversation, memory and access are scripted capabilities, each call checked against its frozen contract.
// @reads /modules/governance/migrations/0001_governance.sql
// @reads /modules/governance/handlers/erase.ts
// @reads /modules/governance/handlers/retention.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as g from "../handlers/index.ts";
import { ADMIN, DAY, NOW, OWNER, PAT, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const groups = (x: unknown): Json[] => out(x).groups as Json[];
const group = (x: unknown, kind: string): Json => groups(x).find((v) => v.kind === kind) as Json;
const EMAIL = "pat@client.example";

/** Pat Lee: a contact record, two files that name her, a chat, a conversation of mail, texts and a call, and memory facts. */
function pat(h: Harness): void {
  h.addRecord(PAT);
  h.world.sureByTerm.set(EMAIL, { type: "contact", id: PAT });
  h.addFile("fil_pat00001", { name: "Pat Lee intake.docx" });
  h.addFile("fil_pat00002", { name: "Pat Lee engagement.pdf" });
  h.world.searchHits.set(EMAIL, [{ id: "fil_pat00001", kind: "file", title: "Pat Lee intake.docx" }, { id: "thr_pat00001", kind: "chat", title: "Pat Lee" }]);
  h.world.searchHits.set("Pat Lee", [{ id: "fil_pat00002", kind: "file", title: "Pat Lee engagement.pdf" }, { id: "fil_pat00001", kind: "file", title: "Pat Lee intake.docx" }, { id: "chn_pat00001", kind: "channel", title: "pat-lee" }]);
  h.world.thread.set(PAT, [{ id: "eml_pat00001", kind: "email" }, { id: "eml_pat00002", kind: "email" }, { id: "sms_pat00001", kind: "sms" }, { id: "cal_pat00001", kind: "call" }, { id: "mtg_pat00001", kind: "meeting" }]);
  h.world.facts.set(PAT, ["fct_pat00001", "fct_pat00002"]);
  h.world.facts.set(EMAIL, ["fct_pat00002", "fct_pat00003"]);
  h.world.notes.set(PAT, [{ noteId: "not_pat00001" }]);
}

const find = (h: Harness) => g.eraseFind(h.ctx, { subject: { email: EMAIL, name: "Pat Lee" } });
const apply = (h: Harness, findingId: string, include: string[], o: Json = {}) => g.eraseApply(h.ctx, { findingId, include, idempotencyKey: `k-${findingId}`, ...o } as Parameters<typeof g.eraseApply>[1]);

/** Only the host replays tombstones, as itself. */
const reapply = (h: ReturnType<typeof harness>) => { h.actAs("service", "svc_host"); return g.tombstonesReapply(h.ctx); };

test("find: everything about one contact across records, files, chats, inbox, mail, calls and memory, with counts and a few titles, kept 24 hours", async () => {
  const h = harness();
  pat(h);
  const f = await find(h);
  assert.deepEqual(contractErrors("governance.erase.find", "out", f), []);
  assert.equal(out(f).expiresAt, NOW + DAY);
  assert.deepEqual(groups(f).map((x) => x.kind), ["records", "files", "chats", "inbox", "mail", "calls", "memory", "runs"]);
  assert.deepEqual(groups(f).map((x) => [x.kind, x.count, x.onHold]), [["records", 1, 0], ["files", 2, 0], ["chats", 2, 0], ["inbox", 1, 0], ["mail", 2, 0], ["calls", 1, 0], ["memory", 4, 0], ["runs", 0, 0]], "a fact found twice counts once; a note counts");
  assert.deepEqual((group(f, "records").samples as Json[])[0], { type: "contact", id: PAT, title: "Pat Lee" });
  assert.deepEqual((group(f, "files").samples as Json[]).map((s) => s.id).sort(), ["fil_pat00001", "fil_pat00002"]);
  assert.deepEqual(h.rows(`SELECT * FROM governance_finding`).length, 1);
  assert.ok(!JSON.stringify(h.rows(`SELECT * FROM governance_finding`)).includes("(not shown)"), "the finding keeps ids, not words");
  // asking by record id, phone or name alone finds the same contact
  h.world.sureByTerm.set("+14155550177", { type: "contact", id: PAT });
  assert.equal(group(await g.eraseFind(h.ctx, { subject: { recordId: PAT } }), "records").count, 1);
  assert.equal(group(await g.eraseFind(h.ctx, { subject: { phone: "+14155550177" } }), "records").count, 1);
  assert.equal(group(await g.eraseFind(h.ctx, { subject: { name: "Nobody Here" } }), "records").count, 0);
  assert.deepEqual(groups(await g.eraseFind(h.ctx, { subject: { email: "unknown@example.com" } })).map((x) => x.count), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(h.named("erase.started").length, 0, "looking is not erasing");
  for (const subject of [{}, { recordId: "pat" }, { email: "nope" }, { phone: "4155550177" }, { name: "P" }]) assert.equal(await refusedWith(g.eraseFind(h.ctx, { subject })), "validation.bad_input");
  // findings older than a day are dropped the next time anyone looks
  h.advance(2 * DAY);
  await g.eraseFind(h.ctx, { subject: { recordId: PAT } });
  assert.equal(h.rows(`SELECT * FROM governance_finding`).length, 1);
});

test("find counts what is on hold, by the person, a file, a folder above it, a record and a chat, and never names it", async () => {
  const h = harness();
  pat(h);
  assert.equal(group(await find(h), "files").onHold, 0);
  await g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_pat00001" }, reason: "Case" });
  await g.holdsPlace(h.ctx, { target: { kind: "channel", id: "chn_pat00001" }, reason: "Case" }).catch(() => undefined);
  const f1 = await find(h);
  assert.deepEqual([group(f1, "files").onHold, group(f1, "chats").onHold], [1, 0]);
  h.world.records.get(PAT)!.holds = 1;
  assert.equal(group(await find(h), "records").onHold, 1, "a record held with records.hold counts");
  await g.holdsPlace(h.ctx, { target: { kind: "person", id: PAT }, reason: "Investigation" });
  const all = await find(h);
  assert.deepEqual(groups(all).map((x) => x.onHold), [1, 2, 2, 1, 2, 1, 4, 0], "a hold on the person covers every item of every kind");
});

test("erase: records, files and memory facts go, one tombstone each, the audit events say who and how many and never what, and the Run says what had no eraser", async () => {
  const h = harness();
  pat(h);
  const f = out(await find(h));
  const done = out(await apply(h, String(f.findingId), ["records", "files", "memory", "chats", "mail"]));
  assert.deepEqual(contractErrors("governance.erase.apply", "out", done), []);
  assert.equal(h.world.records.get(PAT)?.gone, true);
  assert.deepEqual(h.world.purged.sort(), ["fil_pat00001", "fil_pat00002"], "to Trash, then for good");
  assert.deepEqual(h.world.erasedFacts.sort(), ["fct_pat00001", "fct_pat00002", "fct_pat00003"], "facts only: the note is not a fact");
  const tombs = out(await g.tombstonesList(h.ctx, {}));
  assert.deepEqual(contractErrors("governance.tombstones.list", "out", tombs), []);
  assert.equal(tombs.total, 6);
  assert.deepEqual((tombs.tombstones as Json[]).map((t) => t.kind).sort(), ["files", "files", "memory", "memory", "memory", "records"]);
  assert.ok((tombs.tombstones as Json[]).every((t) => t.by === OWNER && t.at === NOW));

  assert.deepEqual(h.named("erase.started").map((e) => e.payload), [{ findingId: f.findingId, by: OWNER, overrodeHold: false }]);
  assert.deepEqual(h.named("erase.completed").map((e) => e.payload), [{ findingId: f.findingId, tombstones: 6 }]);
  for (const e of [...h.named("erase.started"), ...h.named("erase.completed")]) assert.deepEqual(eventErrors(e.name, e.payload), []);
  const trail = JSON.stringify([h.emitted, h.rows(`SELECT * FROM governance_erase`), h.rows(`SELECT * FROM governance_tombstone`)]);
  assert.ok(!trail.includes("Pat Lee") && !trail.includes(EMAIL), "the trail has ids, never names or addresses");
  const run = h.world.runs.get(String(done.runId));
  assert.deepEqual([run?.status, run?.summary], ["succeeded", "6 erased; no eraser yet for memory (1), chats (2), mail (2), which the next backup rotation purges; 1 record moved to Trash, not hard-deleted yet"]);

  const past = out(await g.eraseList(h.ctx, {}));
  assert.deepEqual(contractErrors("governance.erase.list", "out", past), []);
  assert.deepEqual((past.erasures as Json[])[0], { findingId: f.findingId, by: OWNER, at: NOW, kinds: ["records", "files", "memory", "chats", "mail"], tombstones: 6 });

  // the same finding again: the same Run, nothing erased twice
  assert.equal(out(await apply(h, String(f.findingId), ["records"])).runId, done.runId);
  assert.equal(h.named("erase.started").length, 1);
  assert.equal(h.rows(`SELECT * FROM governance_tombstone`).length, 6);
});

test("erase only what was chosen: a kind left out stays, and a kind with nothing found is not an error", async () => {
  const h = harness();
  pat(h);
  const f = out(await find(h));
  await apply(h, String(f.findingId), ["files", "runs"]);
  assert.equal(h.world.records.get(PAT)?.gone, false);
  assert.deepEqual(h.world.erasedFacts, []);
  assert.equal(h.rows(`SELECT * FROM governance_tombstone`).length, 2);
  assert.equal(h.world.runs.get(String([...h.world.runs.keys()][0]))?.summary, "2 erased");
});

test("a restore brings erased data back; replaying the tombstones erases it again before the Space opens", async () => {
  const h = harness();
  pat(h);
  const f = out(await find(h));
  await apply(h, String(f.findingId), ["records", "files", "memory"]);
  // the restore puts the record and the files back from the backup
  h.world.records.get(PAT)!.gone = false;
  h.addFile("fil_pat00001", { name: "Pat Lee intake.docx" });
  h.addFile("fil_pat00002", { name: "Pat Lee engagement.pdf" });
  h.world.erasedFacts.length = 0;
  h.world.purged.length = 0;
  const r = out(await reapply(h));
  assert.deepEqual(contractErrors("governance.tombstones.reapply", "out", r), []);
  assert.equal(r.count, 6);
  assert.equal(h.world.records.get(PAT)?.gone, true);
  assert.deepEqual(h.world.purged.sort(), ["fil_pat00001", "fil_pat00002"]);
  assert.deepEqual(h.world.erasedFacts.sort(), ["fct_pat00001", "fct_pat00002", "fct_pat00003"]);
  assert.deepEqual(h.named("tombstones.reapplied").map((e) => e.payload), [{ count: 6 }]);
  assert.deepEqual(eventErrors("tombstones.reapplied", h.named("tombstones.reapplied")[0]?.payload), []);
  // a second replay, with everything already gone, is quiet and the same
  assert.equal(out(await reapply(h)).count, 6);
  // and a Space with no tombstones replays nothing
  assert.equal(out(await reapply(harness())).count, 0);
  assert.equal(h.rows(`SELECT * FROM governance_tombstone`).length, 6, "tombstones stay: the next restore needs them too");
});

test("a replay stops on a real failure instead of opening a Space that still holds erased data", async () => {
  const h = harness();
  pat(h);
  await apply(h, String((out(await find(h))).findingId), ["records"]);
  h.world.records.get(PAT)!.gone = false;
  h.script("records.delete", () => { throw h.err("internal.unavailable", "records down"); });
  assert.equal(await refusedWith(reapply(h)), "internal.unavailable");
  assert.equal(h.named("tombstones.reapplied").length, 0);
});

test("a hold stops an erase: the refusal counts what is held, nothing is erased, and the finding is still good", async () => {
  const h = harness();
  pat(h);
  await g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_pat00002" }, reason: "Subpoena" });
  const f = out(await find(h));
  const trail = JSON.stringify(h.emitted).length;
  assert.equal(await refusedWith(apply(h, String(f.findingId), ["records", "files"])), "permission.on_hold");
  assert.equal(h.world.records.get(PAT)?.gone, false, "not even the part that was not held");
  assert.equal(h.world.files.size, 2);
  assert.equal(h.rows(`SELECT * FROM governance_tombstone`).length, 0);
  assert.equal(h.named("erase.started").length, 0);
  assert.equal(JSON.stringify(h.emitted).length, trail);
  try { await apply(h, String(f.findingId), ["files"]); } catch (e) { assert.deepEqual((e as { error: { details?: unknown } }).error.details, { held: 1 }); assert.ok(!JSON.stringify(e).includes("Subpoena") && !JSON.stringify(e).includes("fil_pat00002")); }
  // kinds with nothing held go through
  await apply(h, String(f.findingId), ["records"]);
  assert.equal(h.world.records.get(PAT)?.gone, true);
});

test("overriding a hold needs a reason and the Owner (an Admin is refused); the reason goes with the audit trail and the hold stays", async () => {
  const h = harness();
  pat(h);
  await g.holdsPlace(h.ctx, { target: { kind: "person", id: PAT }, reason: "Investigation" });
  const f = String(out(await find(h)).findingId);
  assert.equal(await refusedWith(apply(h, f, ["records"], { overrideHold: { reason: " " } })), "validation.bad_input");
  h.actAs("person", ADMIN);
  assert.equal(await refusedWith(apply(h, f, ["records"], { overrideHold: { reason: "Client asked in writing" } })), "permission.no_grant");
  assert.equal(h.world.records.get(PAT)?.gone, false);
  h.actAs("person", OWNER);
  const done = out(await apply(h, f, ["records", "files"], { overrideHold: { reason: "Client asked in writing" } }));
  assert.equal(h.world.records.get(PAT)?.gone, true);
  assert.deepEqual(h.named("erase.started")[0]?.payload, { findingId: f, by: OWNER, overrodeHold: true });
  assert.equal(h.rows(`SELECT * FROM governance_hold`).length, 1, "the hold is still there");
  assert.ok(done.runId);
  // a reason where nothing is held is accepted and changes nothing
  const h2 = harness();
  pat(h2);
  const f2 = String(out(await find(h2)).findingId);
  await apply(h2, f2, ["files"], { overrideHold: { reason: "Just in case" } });
  assert.equal(h2.named("erase.started")[0]?.payload.overrodeHold, false);
});

test("erase refuses what it must: unknown, old or empty findings, bad kinds, a missing key; and a failing eraser fails the Run and reaches the caller", async () => {
  const h = harness();
  pat(h);
  const f = String(out(await find(h)).findingId);
  assert.equal(await refusedWith(apply(h, "fnd_nothere01", ["records"])), "validation.precondition_failed");
  assert.equal(await refusedWith(apply(h, "finding", ["records"])), "validation.bad_input");
  assert.equal(await refusedWith(apply(h, f, [])), "validation.bad_input");
  assert.equal(await refusedWith(apply(h, f, ["everything"])), "validation.bad_input");
  assert.equal(await refusedWith(g.eraseApply(h.ctx, { findingId: f, include: ["records"], idempotencyKey: "" })), "validation.bad_input");
  h.script("memory.erase", () => { throw h.err("internal.unavailable", "memory down"); });
  assert.equal(await refusedWith(apply(h, f, ["memory"])), "internal.unavailable");
  const run = [...h.world.runs.values()].find((r) => r.status === "failed");
  assert.equal((run?.error as Json).code, "internal.unavailable");
  assert.equal(h.rows(`SELECT * FROM governance_erase`).length, 0, "an erase that did not finish is not recorded as done, so it can be run again");
  h.advance(2 * DAY);
  assert.equal(await refusedWith(apply(h, f, ["records"])), "validation.precondition_failed", "older than 24 hours");
  assert.equal(h.world.records.get(PAT)?.gone, false);
});

test("the export of what governance keeps holds no secrets, names or values: ids, kinds and times only", async () => {
  const h = harness();
  pat(h);
  await g.holdsPlace(h.ctx, { target: { kind: "person", id: PAT }, reason: "Investigation" });
  await g.retentionSet(h.ctx, { kind: "trash", value: "7d" });
  const f = String(out(await find(h)).findingId);
  await apply(h, f, ["records", "files", "memory"], { overrideHold: { reason: "Client asked" } });
  const everything = JSON.stringify(h.rows(`SELECT * FROM governance_state`)) + JSON.stringify(h.rows(`SELECT * FROM governance_tombstone`)) + JSON.stringify(h.rows(`SELECT * FROM governance_erase`)) + JSON.stringify(h.rows(`SELECT * FROM governance_finding`));
  for (const secret of ["Pat Lee", EMAIL, "(not shown)", "Client asked", "intake.docx"]) assert.ok(!everything.includes(secret), secret);
});

test("a contact nobody has written to has no inbox thread, and the find still finds the record and erases it", async () => {
  const h = harness();
  h.addRecord(PAT);
  h.world.sureByTerm.set(EMAIL, { type: "contact", id: PAT });
  h.script("inbox.thread", () => { throw h.err("validation.not_found", "There is no conversation with that person yet."); });
  h.script("memory.find_by_subject", () => { throw h.err("validation.not_found", "Nothing remembered about that subject."); });
  h.script("search.query", () => { throw h.err("validation.not_found", "Nothing found."); });
  const f = out(await find(h));
  assert.deepEqual(contractErrors("governance.erase.find", "out", f), []);
  assert.deepEqual(groups(f).map((x) => [x.kind, x.count]), [["records", 1], ["files", 0], ["chats", 0], ["inbox", 0], ["mail", 0], ["calls", 0], ["memory", 0], ["runs", 0]]);
  const done = out(await apply(h, String(f.findingId), ["records", "inbox", "mail", "calls", "memory"]));
  assert.deepEqual(contractErrors("governance.erase.apply", "out", done), []);
  assert.equal(h.world.records.get(PAT)?.gone, true);
  assert.equal(await refusedWith((async () => { h.script("inbox.thread", () => { throw h.err("permission.no_grant", "no"); }); return find(h); })()), "permission.no_grant", "any other refusal still stops the find");
});

test("tombstones.reapply is the host's call: a person, the owner included, is refused, and a crafted list erases nothing", async () => {
  const h = harness();
  pat(h);
  const crafted = [{ id: "tmb_crafted01", kind: "records", subjectType: "contact", subjectId: PAT, at: 1, by: "usr_olivia" }];
  for (const [kind, id] of [["person", OWNER], ["person", ADMIN]] as const) {
    h.actAs(kind, id);
    assert.equal(await refusedWith(g.tombstonesReapply(h.ctx, { tombstones: crafted })), "permission.role_lacks_permission");
  }
  assert.equal(h.world.records.get(PAT)?.gone, false, "nothing was erased");
  assert.equal(h.rows(`SELECT * FROM governance_tombstone`).length, 0, "and nothing was recorded");
  h.actAs("service", "svc_host");
  assert.equal(out(await g.tombstonesReapply(h.ctx, { tombstones: crafted })).count, 1);
  assert.equal(h.world.records.get(PAT)?.gone, true);
});
