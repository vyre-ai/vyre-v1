// Retention and holds (P-L7_13; spec 2.26; ARCH 4.11): the ten kinds with their defaults and the Space's overrides, the daily job per kind (expiry, a hold blocks purge), and holds on files, channels, threads,
// folders and people. Files, audit, settings and runs are scripted capabilities, each call checked against its frozen contract.
// @reads /modules/governance/migrations/0001_governance.sql
// @reads /modules/governance/handlers/retention.ts
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import * as g from "../handlers/index.ts";
import { DEFS, ageOf } from "../projections.ts";
import { ADMIN, DAY, FOLDER, NOW, OWNER, PAT, PARENT, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const rows = (x: unknown, k: string): Json[] => out(x)[k] as Json[];

test("the module's copy of the retention defaults is the manifest's", () => {
  const manifest = registry.retention.filter((r) => r.module === "governance");
  const row = (r: { key: string; title: string; default: string; holdable: boolean; tombstone: boolean }) => [r.key, r.title, r.default, r.holdable, r.tombstone];
  assert.deepEqual(DEFS.map(row).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), manifest.map(row).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  assert.equal(ageOf("90d"), 90 * DAY);
  assert.equal(ageOf("2y"), 2 * 365 * DAY);
  assert.equal(ageOf("3m"), 90 * DAY);
  assert.equal(ageOf("2w"), 14 * DAY);
  for (const v of ["forever", "per_policy", "30d+daily90d+monthly", "d", ""]) assert.equal(ageOf(v), null, v);
});

test("get shows every kind with its default and what is in force; set and reset change one kind and say so once", async () => {
  const h = harness();
  const got = out(await g.retentionGet(h.ctx));
  assert.deepEqual(contractErrors("governance.retention.get", "out", got), []);
  assert.equal(rows(got, "kinds").length, 10);
  const trash = rows(got, "kinds").find((k) => k.key === "trash");
  assert.deepEqual([trash?.default, trash?.value, trash?.overridden, trash?.holdable, trash?.tombstone], ["30d", "30d", false, true, false]);

  const set = out(await g.retentionSet(h.ctx, { kind: "trash", value: "7d" }));
  assert.deepEqual(contractErrors("governance.retention.set", "out", set), []);
  assert.deepEqual([out(set.row).value, out(set.row).overridden], ["7d", true]);
  assert.deepEqual(h.world.settings.get("retention.overrides"), { trash: "7d" });
  assert.deepEqual(h.named("policy.changed")[0]?.payload, { key: "retention.trash", scope: "space", kind: "retention", by: OWNER });
  assert.deepEqual(eventErrors("policy.changed", h.named("policy.changed")[0]?.payload), []);
  await g.retentionSet(h.ctx, { kind: "trash", value: "7d" });
  assert.equal(h.named("policy.changed").length, 1, "the same value again changes nothing");

  // back to the default value is not an override
  await g.retentionSet(h.ctx, { kind: "trash", value: "30d" });
  assert.deepEqual(h.world.settings.get("retention.overrides"), {});
  await g.retentionSet(h.ctx, { kind: "transcripts", value: "forever" });
  const reset = out(await g.retentionReset(h.ctx, { kind: "transcripts" }));
  assert.deepEqual([out(reset.row).value, out(reset.row).overridden], ["1y", false]);
  const events = h.named("policy.changed").length;
  await g.retentionReset(h.ctx, { kind: "transcripts" });
  assert.equal(h.named("policy.changed").length, events, "resetting what was never set says nothing");
});

test("records are set per record type, other kinds are not, and bad values and kinds are refused", async () => {
  const h = harness();
  const set = out(await g.retentionSet(h.ctx, { kind: "records", value: "5y", recordType: "contact" }));
  assert.deepEqual(out(set.row).perRecordType, { contact: "5y" });
  assert.equal(out(set.row).overridden, false, "the kind itself is still at its default");
  assert.deepEqual(h.named("policy.changed")[0]?.payload.key, "retention.records:contact");
  await g.retentionSet(h.ctx, { kind: "records", value: "3y" });
  const got = rows(out(await g.retentionGet(h.ctx)), "kinds").find((k) => k.key === "records");
  assert.deepEqual([got?.value, got?.overridden, got?.perRecordType], ["3y", true, { contact: "5y" }]);
  const reset = out(await g.retentionReset(h.ctx, { kind: "records", recordType: "contact" }));
  assert.equal(out(reset.row).perRecordType, undefined);
  for (const run of [
    () => g.retentionSet(h.ctx, { kind: "trash", value: "7d", recordType: "contact" }), () => g.retentionSet(h.ctx, { kind: "records", value: "7d", recordType: "Contact!" }),
    () => g.retentionSet(h.ctx, { kind: "trash", value: "a week" }), () => g.retentionSet(h.ctx, { kind: "trash", value: "0.5d" }), () => g.retentionSet(h.ctx, { kind: "coffee", value: "7d" }),
    () => g.retentionReset(h.ctx, { kind: "coffee" }), () => g.retentionReset(h.ctx, { kind: "audit", recordType: "x" }),
  ]) assert.equal(await refusedWith(run()), "validation.bad_input");
  assert.equal(JSON.stringify(h.world.settings.get("retention.overrides")).includes("coffee"), false);
});

test("the trash job purges what has been in Trash longer than the retention and keeps the rest", async () => {
  const h = harness();
  h.addFile("fil_old00001", { deletedAt: NOW - 40 * DAY });
  h.addFile("fil_old00002", { deletedAt: NOW - 31 * DAY });
  h.addFile("fil_new00001", { deletedAt: NOW - 5 * DAY });
  h.addFile("fil_live0001");
  const r = out(await g.jobsTick(h.ctx, { kind: "trash" }));
  assert.deepEqual(contractErrors("governance.jobs.tick", "out", r), []);
  assert.deepEqual(r, { removed: 2, skippedOnHold: 0 });
  assert.deepEqual(h.world.purged.sort(), ["fil_old00001", "fil_old00002"]);
  assert.deepEqual([...h.world.files.keys()].sort(), ["fil_live0001", "fil_new00001"]);
  assert.deepEqual(h.named("retention.purged")[0]?.payload, { kind: "trash", removed: 2, skippedOnHold: 0 });

  // a shorter retention reaches the file that was five days in Trash
  await g.retentionSet(h.ctx, { kind: "trash", value: "3d" });
  assert.deepEqual(out(await g.jobsTick(h.ctx, { kind: "trash" })), { removed: 1, skippedOnHold: 0 });
  assert.deepEqual([...h.world.files.keys()], ["fil_live0001"]);
  // forever removes nothing
  h.addFile("fil_old00003", { deletedAt: NOW - 900 * DAY });
  await g.retentionSet(h.ctx, { kind: "trash", value: "forever" });
  assert.deepEqual(out(await g.jobsTick(h.ctx, { kind: "trash" })), { removed: 0, skippedOnHold: 0 });
  assert.ok(h.world.files.has("fil_old00003"));
});

test("a hold blocks the purge: on the file, on a folder above it, on its owner; the job counts what it skipped; release lets it go", async () => {
  const h = harness();
  h.world.folders.set("fld_deep00001", FOLDER);
  h.addFile("fil_held0001", { deletedAt: NOW - 60 * DAY });
  h.addFile("fil_infolder", { deletedAt: NOW - 60 * DAY, folderId: "fld_deep00001" });
  h.addFile("fil_owned001", { deletedAt: NOW - 60 * DAY, ownerId: "usr_rob00002" });
  h.addFile("fil_free0001", { deletedAt: NOW - 60 * DAY, ownerId: "usr_maya0001" });
  await g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_held0001" }, reason: "Litigation" });
  await g.holdsPlace(h.ctx, { target: { kind: "folder", id: FOLDER }, reason: "Case 42" });
  await g.holdsPlace(h.ctx, { target: { kind: "person", id: "usr_rob00002" }, reason: "Investigation" });
  const r = out(await g.jobsTick(h.ctx, { kind: "trash" }));
  assert.deepEqual(r, { removed: 0, skippedOnHold: 4 }, "the folder hold covers the free file too: it sits in that folder");
  assert.deepEqual(h.world.purged, []);
  const job = rows(await g.jobsList(h.ctx), "jobs").find((j) => j.kind === "trash");
  assert.deepEqual([job?.lastRemoved, job?.lastSkippedOnHold, job?.state], [0, 4, "idle"]);

  await g.holdsRelease(h.ctx, { target: { kind: "folder", id: FOLDER } });
  assert.deepEqual(out(await g.jobsTick(h.ctx, { kind: "trash" })), { removed: 2, skippedOnHold: 2 }, "the file and the owner are still held");
  assert.deepEqual(h.world.purged.sort(), ["fil_free0001", "fil_infolder"]);
  await g.holdsRelease(h.ctx, { target: { kind: "file", id: "fil_held0001" } });
  await g.holdsRelease(h.ctx, { target: { kind: "person", id: "usr_rob00002" } });
  assert.deepEqual(out(await g.jobsTick(h.ctx, { kind: "trash" })), { removed: 2, skippedOnHold: 0 });
  assert.equal(h.world.files.size, 0);
});

test("the audit job moves rows past the retention into the archive; kinds with no purge capability yet remove nothing and say so", async () => {
  const h = harness();
  h.world.archiveReturns = 12;
  assert.deepEqual(out(await g.jobsTick(h.ctx, { kind: "audit" })), { removed: 12, skippedOnHold: 0 });
  assert.deepEqual(h.world.archivedBefore, [NOW - 2 * 365 * DAY]);
  await g.retentionSet(h.ctx, { kind: "audit", value: "3y" });
  await g.jobsTick(h.ctx, { kind: "audit" });
  assert.equal(h.world.archivedBefore[1], NOW - 3 * 365 * DAY, "the override is what the job reads");
  for (const kind of ["run_logs", "transcripts", "file_versions", "logs", "events", "backups", "memory", "records"]) {
    assert.deepEqual(out(await g.jobsTick(h.ctx, { kind })), { removed: 0, skippedOnHold: 0 }, kind);
    assert.deepEqual(h.named("retention.purged").at(-1)?.payload, { kind, removed: 0, skippedOnHold: 0 });
  }
  assert.equal(h.world.archivedBefore.length, 2);
  assert.equal(await refusedWith(g.jobsTick(h.ctx, { kind: "coffee" })), "validation.bad_input");
  h.script("audit.archive", () => { throw h.err("internal.unavailable", "down"); });
  await g.retentionSet(h.ctx, { kind: "audit", value: "1y" });
  assert.equal(await refusedWith(g.jobsTick(h.ctx, { kind: "audit" })), "internal.unavailable");
  assert.equal(rows(await g.jobsList(h.ctx), "jobs").find((j) => j.kind === "audit")?.state, "failed");
});

test("jobs: scheduled for tomorrow once, listed with their numbers, run now in a Run, health says what is late", async () => {
  const h = harness();
  const none = out(await g.jobsList(h.ctx));
  assert.deepEqual(contractErrors("governance.jobs.list", "out", none), []);
  assert.deepEqual(rows(none, "jobs").map((j) => j.kind), ["trash", "run_logs", "transcripts", "audit", "file_versions", "logs", "events", "backups", "memory", "records"]);
  assert.ok(rows(none, "jobs").every((j) => j.state === "idle" && j.lastRunAt === undefined));
  assert.deepEqual(out(await g.jobsHealth(h.ctx)), { state: "healthy" });

  await g.jobsTick(h.ctx, { kind: "trash" });
  assert.deepEqual(h.scheduled.map((s) => [s.at, s.cap, s.input]), [[NOW + DAY, "governance.jobs.tick", { kind: "trash" }]]);
  const j = rows(await g.jobsList(h.ctx), "jobs")[0];
  assert.deepEqual([j?.lastRunAt, j?.nextRunAt], [NOW, NOW + DAY]);
  // run now does the work and does not add a second schedule
  h.advance(3_600_000);
  const run = out(await g.jobsRunNow(h.ctx, { kind: "trash", idempotencyKey: "rn-1" }));
  assert.deepEqual(contractErrors("governance.jobs.run_now", "out", run), []);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.world.runs.get(String(run.runId))?.status, "succeeded");
  assert.equal(h.world.runs.get(String(run.runId))?.summary, "0 removed, 0 skipped on hold");
  // the scheduled call fires: the next day is scheduled
  h.advance(DAY);
  await g.jobsTick(h.ctx, { kind: "trash" });
  assert.equal(h.scheduled.length, 2);
  assert.equal(h.scheduled[1]?.at, NOW + 3_600_000 + DAY + DAY);

  h.advance(3 * DAY);
  const late = out(await g.jobsHealth(h.ctx));
  assert.equal(late.state, "degraded");
  assert.match(String(late.detail), /trash/);
  assert.equal(await refusedWith(g.jobsRunNow(h.ctx, { kind: "coffee", idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(await refusedWith(g.jobsRunNow(h.ctx, { kind: "trash", idempotencyKey: "" })), "validation.bad_input");
  h.script("files.trash.list", () => { throw h.err("internal.unavailable", "down"); });
  assert.equal(await refusedWith(g.jobsRunNow(h.ctx, { kind: "trash", idempotencyKey: "rn-2" })), "internal.unavailable");
  assert.equal([...h.world.runs.values()].filter((r) => r.status === "failed").length, 1);
  assert.equal(out(await g.jobsHealth(h.ctx)).state, "down");
});

test("holds: place on a file, channel, thread, folder or person; one hold per target; list, filter, page; release; refusals", async () => {
  const h = harness();
  h.addFile("fil_doc00001");
  h.world.channels.add("chn_intake001");
  assert.deepEqual(await g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_doc00001" }, reason: "Subpoena" }), { ok: true });
  assert.deepEqual(h.named("hold.placed")[0]?.payload, { target: { kind: "file", id: "fil_doc00001" }, reason: "Subpoena", by: OWNER });
  assert.deepEqual(eventErrors("hold.placed", h.named("hold.placed")[0]?.payload), []);
  h.actAs("person", ADMIN);
  await g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_doc00001" }, reason: "Another reason" });
  assert.equal(h.named("hold.placed").length, 1, "a second hold on the same file changes nothing");
  assert.equal(h.rows(`SELECT * FROM gov_hold`)[0]?.reason, "Subpoena");
  for (const target of [{ kind: "channel", id: "chn_intake001" }, { kind: "thread", id: "thr_t0000001" }, { kind: "folder", id: FOLDER }, { kind: "person", id: PAT }, { kind: "person", id: "usr_rob00002" }]) {
    h.advance(1000);
    await g.holdsPlace(h.ctx, { target, reason: "Matter 7" });
  }
  const all = out(await g.holdsList(h.ctx, {}));
  assert.deepEqual(contractErrors("governance.holds.list", "out", all), []);
  assert.equal(all.total, 6);
  assert.deepEqual(rows(all, "holds")[0]?.by, ADMIN);
  assert.deepEqual(rows(all, "holds").map((x) => out(x.target).kind), ["person", "person", "folder", "thread", "channel", "file"], "newest first");
  assert.deepEqual(rows(await g.holdsList(h.ctx, { kind: "file" }), "holds").map((x) => [x.title, x.reason, x.by]), [["fil_doc00001.txt", "Subpoena", OWNER]]);
  assert.equal(rows(await g.holdsList(h.ctx, { kind: "channel" }), "holds")[0]?.title, "Intake");
  assert.equal(rows(await g.holdsList(h.ctx, { kind: "thread" }), "holds")[0]?.title, "thr_t0000001");
  const page = out(await g.holdsList(h.ctx, { limit: 4 }));
  assert.deepEqual([rows(page, "holds").length, page.next], [4, "4"]);
  assert.equal(rows(await g.holdsList(h.ctx, { limit: 4, cursor: "4" }), "holds").length, 2);

  assert.deepEqual(await g.holdsRelease(h.ctx, { target: { kind: "file", id: "fil_doc00001" } }), { ok: true });
  assert.deepEqual(h.named("hold.released")[0]?.payload, { target: { kind: "file", id: "fil_doc00001" }, by: ADMIN });
  assert.equal(await refusedWith(g.holdsRelease(h.ctx, { target: { kind: "file", id: "fil_doc00001" } })), "validation.not_found");

  for (const run of [
    () => g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_doc00001" }, reason: " " }), () => g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_doc00001" }, reason: "x".repeat(501) }),
    () => g.holdsPlace(h.ctx, { target: { kind: "record", id: PAT }, reason: "x" }), () => g.holdsPlace(h.ctx, { target: { kind: "file", id: "folder" }, reason: "x" }),
    () => g.holdsPlace(h.ctx, { target: { kind: "file", id: FOLDER }, reason: "x" }), () => g.holdsList(h.ctx, { kind: "everything" }), () => g.holdsList(h.ctx, { limit: 0 }), () => g.holdsRelease(h.ctx, { target: { kind: "file" } }),
  ]) assert.equal(await refusedWith(run()), "validation.bad_input");
  assert.equal(await refusedWith(g.holdsPlace(h.ctx, { target: { kind: "file", id: "fil_nothere01" }, reason: "x" })), "validation.not_found");
  assert.equal(await refusedWith(g.holdsPlace(h.ctx, { target: { kind: "folder", id: "fld_nothere01" }, reason: "x" })), "validation.not_found");
  assert.equal(await refusedWith(g.holdsPlace(h.ctx, { target: { kind: "channel", id: "chn_nothere01" }, reason: "x" })), "validation.not_found");
  assert.ok(PARENT.length > 0);
});
