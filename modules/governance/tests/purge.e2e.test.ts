// P-L7_15: erasers and purgers end to end across every store, against scripted owning modules that keep real in-memory data and remove it only when their eraser or purger capability is called. A person
// is erased from every kind and nothing of theirs is left in any store; a purge removes aged rows and spares young ones; a store whose capability is not in the contract yet says `no_eraser` /
// `no_purger` and removes nothing. This is not a booted daemon: the erase capabilities of chats, inbox, mail, calls, runs, run logs, transcripts, file versions, logs, events and records are a contract
// request to the steward (comment on P-L7_15), so a booted proof waits for them.
import test from "node:test";
import assert from "node:assert/strict";
import { eraseItem, purgeKind } from "../handlers/erasers.ts";
import { heldFor, jobsList, seedTicks } from "../handlers/retention.ts";
import { harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import type { GovCtx } from "../projections.ts";

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;
const PAT = "rec_pat00001";

type Row = Record<string, unknown>;
const unknownCap = () => Object.assign(new Error("unknown"), { error: { code: "validation.unknown_capability" } });
const notFound = () => Object.assign(new Error("gone"), { error: { code: "validation.not_found" } });

/** Every store the erase touches, with Pat's data and someone else's in each. */
function stores() {
  const s = {
    records: new Map<string, Row>([[PAT, { type: "contact", name: "Pat Lee" }], ["rec_other0001", { type: "contact", name: "Other" }]]),
    trash: new Set<string>(),
    files: new Map<string, Row>([["fil_pat00001", {}], ["fil_other0001", {}]]),
    trashedFiles: new Set<string>(),
    threads: new Set(["thr_pat00001", "thr_other0001"]),
    channels: new Set(["chn_pat00001", "chn_other0001"]),
    sms: new Set(["sms_pat00001", "sms_other0001"]),
    calls: new Set(["cal_pat00001", "cal_other0001"]),
    mail: new Set(["eml_pat00001", "eml_other0001"]),
    notes: new Set(["not_pat00001", "not_other0001"]),
    facts: new Set(["fct_pat00001", "fct_other0001"]),
    runs: new Map<string, number>([["run_pat00001", NOW - 200 * DAY], ["run_young001", NOW - 5 * DAY], ["run_old00001", NOW - 400 * DAY]]),
    transcripts: new Map<string, number>([["tr_old", NOW - 800 * DAY], ["tr_young", NOW - 10 * DAY]]),
    versions: new Map<string, number>([["ver_old", NOW - 500 * DAY], ["ver_young", NOW - 2 * DAY]]),
    logs: new Map<string, number>([["log_old", NOW - 90 * DAY], ["log_young", NOW - 1 * DAY]]),
    events: new Map<string, number>([["evt_old", NOW - 90 * DAY], ["evt_young", NOW - 3 * DAY]]),
    trashedRecords: new Map<string, number>([["rec_trash_old", NOW - 90 * DAY], ["rec_trash_new", NOW - 1 * DAY]]),
    backups: new Map<string, { at: number; verified: boolean }>([
      ["bkp_old0001", { at: NOW - 400 * DAY, verified: true }], ["bkp_old0002", { at: NOW - 300 * DAY, verified: false }], ["bkp_mid0001", { at: NOW - 100 * DAY, verified: true }], ["bkp_new0001", { at: NOW - 1 * DAY, verified: true }],
    ]),
    calls_made: [] as string[],
  };
  return s;
}
type Stores = ReturnType<typeof stores>;

const purgeBy = (m: Map<string, number>, before: number): number => { let n = 0; for (const [k, at] of m) if (at < before) { m.delete(k); n++; } return n; };

/** The owning modules, as capabilities. `missing` names capabilities the contract does not have yet: they answer unknown_capability. */
function world(s: Stores, missing: string[] = []): GovCtx {
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    s.calls_made.push(cap);
    if (missing.includes(cap)) throw unknownCap();
    const i = input as Row;
    switch (cap) {
      case "records.delete": { const id = String(i["recordId"]); if (!s.records.has(id)) throw notFound(); s.trash.add(id); return { ok: true }; }
      case "records.purge": { const id = String(i["recordId"]); const had = s.records.delete(id) || s.trash.delete(id); if (!had) throw notFound(); s.trash.delete(id); return { erased: true }; }
      case "files.delete": { const id = String(i["fileId"]); if (!s.files.has(id)) throw notFound(); s.trashedFiles.add(id); return { ok: true }; }
      case "files.purge": { const id = String(i["fileId"]); if (!s.trashedFiles.delete(id)) throw notFound(); s.files.delete(id); return { purged: true }; }
      case "threads.erase": return { erased: s.threads.delete(String(i["threadId"])) };
      case "channels.erase": return { erased: s.channels.delete(String(i["channelId"])) };
      case "telephony.sms.erase": return { erased: s.sms.delete(String(i["smsId"])) };
      case "telephony.call.erase": return { erased: s.calls.delete(String(i["callId"])) };
      case "mail.message.erase": return { erased: s.mail.delete(String(i["messageId"])) };
      case "memory.notes.erase": return { erased: s.notes.delete(String(i["noteId"])) };
      case "memory.erase": { let n = 0; for (const f of i["factIds"] as string[]) if (s.facts.delete(f)) n++; return { erased: n }; }
      case "runs.erase": return { erased: s.runs.delete(String(i["runId"])) };
      case "runs.purge": return { removed: purgeBy(s.runs, Number(i["before"])), more: false };
      case "chat.transcript.purge": return { removed: purgeBy(s.transcripts, Number(i["before"])), more: false };
      case "files.versions_purge": return { removed: purgeBy(s.versions, Number(i["before"])), more: false };
      case "logs.purge": return { removed: purgeBy(s.logs, Number(i["before"])), more: false };
      case "events.compact": return { removed: purgeBy(s.events, Number(i["before"])), more: false };
      case "records.purge_trashed": return { removed: purgeBy(s.trashedRecords, Number(i["before"])), more: false };
      case "backup.list": return { backups: [...s.backups].map(([backupId, b]) => ({ backupId, at: b.at, verified: b.verified, kind: "scheduled", seq: 1, sizeBytes: 1, target: "t" })) };
      case "backup.delete": return { deleted: s.backups.delete(String(i["backupId"])) };
      default: throw new Error(`unscripted ${cap}`);
    }
  };
  return { call } as unknown as GovCtx;
}

const PAT_ITEMS: [Parameters<typeof eraseItem>[1], string, string][] = [
  ["records", "contact", PAT], ["files", "file", "fil_pat00001"], ["chats", "chat", "thr_pat00001"], ["chats", "channel", "chn_pat00001"], ["inbox", "sms", "sms_pat00001"],
  ["calls", "call", "cal_pat00001"], ["mail", "email", "eml_pat00001"], ["memory", "note", "not_pat00001"], ["memory", "fact", "fct_pat00001"], ["runs", "run", "run_pat00001"],
];

test("erase a person from every store: each item is erased, nothing of theirs is left anywhere, and someone else's data stays", async () => {
  const s = stores();
  const ctx = world(s);
  for (const [kind, type, id] of PAT_ITEMS) assert.equal(await eraseItem(ctx, kind, type, id, "Erase a person"), "erased", `${kind}:${id}`);
  assert.deepEqual([s.records.has(PAT), s.trash.has(PAT)], [false, false], "a record is hard-deleted, not left in Trash");
  assert.deepEqual([s.files.has("fil_pat00001"), s.trashedFiles.has("fil_pat00001")], [false, false]);
  for (const [name, set] of [["threads", s.threads], ["channels", s.channels], ["sms", s.sms], ["calls", s.calls], ["mail", s.mail], ["notes", s.notes], ["facts", s.facts]] as const) {
    assert.ok(![...set].some((id) => id.includes("pat")), `${name}: nothing of Pat's is left`);
    assert.equal(set.size, 1, `${name}: the other person's item stays`);
  }
  assert.equal(s.runs.has("run_pat00001"), false);
  assert.deepEqual([...s.records.keys()], ["rec_other0001"]);
  assert.ok([...s.runs.keys()].includes("run_young001"));
});

test("erasing again, or after a restore brought the data back, is one more call and the same result: gone is not a failure", async () => {
  const s = stores();
  const ctx = world(s);
  for (const [kind, type, id] of PAT_ITEMS) await eraseItem(ctx, kind, type, id, "r");
  for (const [kind, type, id] of PAT_ITEMS) assert.equal(await eraseItem(ctx, kind, type, id, "replay"), "gone", `${kind}:${id}`);
  s.threads.add("thr_pat00001");   // a restore brought a chat back
  assert.equal(await eraseItem(ctx, "chats", "chat", "thr_pat00001", "replay"), "erased");
  assert.equal(s.threads.has("thr_pat00001"), false);
});

test("a kind whose eraser is not in the contract yet is no_eraser: it removes nothing and never counts as erased", async () => {
  const s = stores();
  const ctx = world(s, ["threads.erase", "mail.message.erase", "records.purge"]);
  assert.equal(await eraseItem(ctx, "chats", "chat", "thr_pat00001", "r"), "no_eraser");
  assert.equal(await eraseItem(ctx, "mail", "email", "eml_pat00001", "r"), "no_eraser");
  assert.equal(await eraseItem(ctx, "records", "contact", PAT, "r"), "trashed", "a record is taken out of views but is not hard-deleted");
  assert.ok(s.threads.has("thr_pat00001") && s.mail.has("eml_pat00001"), "nothing was removed");
  assert.ok(s.records.has(PAT), "the record is still stored: it is reported trashed, not erased");
  assert.ok(s.trash.has(PAT));
  assert.equal(await eraseItem(ctx, "calls", "meeting", "mtg_x0000001", "r"), "no_eraser", "a type nobody can erase");
});

test("an error other than gone or a missing capability stops the erase and is thrown, not swallowed", async () => {
  const s = stores();
  const base = world(s);
  const ctx = { call: async (cap: string, input: unknown) => { if (cap === "telephony.call.erase") throw Object.assign(new Error("hold"), { error: { code: "permission.on_hold" } }); return (base.call as (c: string, i: unknown) => Promise<unknown>)(cap, input); } } as unknown as GovCtx;
  await assert.rejects(eraseItem(ctx, "calls", "call", "cal_pat00001", "r"), (e) => (e as { error?: { code?: string } }).error?.code === "permission.on_hold");
  assert.ok(s.calls.has("cal_pat00001"));
});

test("retention removes aged rows in every purgeable kind and spares the young ones", async () => {
  const s = stores();
  const ctx = world(s);
  const cutoff = (days: number): number => NOW - days * DAY;
  assert.deepEqual(await purgeKind(ctx, "run_logs", cutoff(90), "2025-10-09"), { kind: "run_logs", status: "purged", removed: 2 });
  assert.deepEqual([...s.runs.keys()], ["run_young001"]);
  assert.deepEqual(await purgeKind(ctx, "transcripts", cutoff(365), "d"), { kind: "transcripts", status: "purged", removed: 1 });
  assert.deepEqual(await purgeKind(ctx, "file_versions", cutoff(30), "d"), { kind: "file_versions", status: "purged", removed: 1 });
  assert.deepEqual(await purgeKind(ctx, "logs", cutoff(30), "d"), { kind: "logs", status: "purged", removed: 1 });
  assert.deepEqual(await purgeKind(ctx, "events", cutoff(30), "d"), { kind: "events", status: "purged", removed: 1 });
  assert.deepEqual(await purgeKind(ctx, "records", cutoff(30), "d"), { kind: "records", status: "purged", removed: 1 });
  assert.deepEqual([...s.transcripts.keys(), ...s.versions.keys(), ...s.logs.keys(), ...s.events.keys(), ...s.trashedRecords.keys()], ["tr_young", "ver_young", "log_young", "evt_young", "rec_trash_new"]);
});

test("backups past the cutoff go, but the newest verified one always stays", async () => {
  const s = stores();
  const ctx = world(s);
  const out = await purgeKind(ctx, "backups", NOW + DAY, "d");   // a cutoff that would take them all
  assert.deepEqual(out, { kind: "backups", status: "purged", removed: 3 });
  assert.deepEqual([...s.backups.keys()], ["bkp_new0001"], "the newest verified backup is kept");
  const t = stores();
  assert.deepEqual(await purgeKind(world(t), "backups", NOW - 200 * DAY, "d"), { kind: "backups", status: "purged", removed: 2 });
  assert.deepEqual([...t.backups.keys()].sort(), ["bkp_mid0001", "bkp_new0001"]);
});

test("a kind with no purger in the contract, and one whose capability is missing, say so and remove nothing", async () => {
  const s = stores();
  const ctx = world(s, ["logs.purge"]);
  assert.deepEqual(await purgeKind(ctx, "logs", NOW, "d"), { kind: "logs", status: "no_purger" });
  assert.equal(s.logs.size, 2);
  assert.deepEqual(await purgeKind(ctx, "memory", NOW, "d"), { kind: "memory", status: "no_purger" });
  assert.deepEqual(await purgeKind(ctx, "audit", NOW, "d"), { kind: "audit", status: "no_purger" }, "audit is archived by retention.ts, not purged here");
});

test("a purge works in batches until the store says there is no more, with one idempotency key per batch and day", async () => {
  const seen: Row[] = [];
  const ctx = { call: async (_c: string, i: unknown) => { seen.push(i as Row); return { removed: 500, more: seen.length < 3 }; } } as unknown as GovCtx;
  assert.deepEqual(await purgeKind(ctx, "logs", NOW, "2025-10-09"), { kind: "logs", status: "purged", removed: 1500 });
  assert.deepEqual(seen.map((i) => i["idempotencyKey"]), ["gov-purge:logs:2025-10-09:0", "gov-purge:logs:2025-10-09:1", "gov-purge:logs:2025-10-09:2"]);
});

test("boot seeds the first daily tick for every kind once: a second boot schedules nothing, a kind whose tick lapsed gets a new one", async () => {
  const h = harness();
  assert.deepEqual(await seedTicks(h.ctx), { scheduled: 10 });
  assert.equal(h.scheduled.length, 10);
  assert.deepEqual(new Set(h.scheduled.map((x) => x.cap)), new Set(["governance.jobs.tick"]));
  assert.deepEqual(h.scheduled.map((x) => (x.input as { kind: string }).kind).sort(), ["audit", "backups", "events", "file_versions", "logs", "memory", "records", "run_logs", "transcripts", "trash"]);
  assert.ok(h.scheduled.every((x) => x.at === NOW + DAY));
  const jobs = (await jobsList(h.ctx)).jobs as Row[];
  assert.ok(jobs.every((j) => j["nextRunAt"] === NOW + DAY), "the job rows say when the first tick is");
  assert.deepEqual(await seedTicks(h.ctx), { scheduled: 0 }, "a second boot adds no second tick");
  assert.equal(h.scheduled.length, 10);
});

test("holds keep data out of an age purge: held files and threads are passed by id, and a hold on a person or a folder keeps the whole kind", async () => {
  const h = harness();
  ensure(h.ctx);
  const hold = (kind: string, id: string) => h.ctx.db.run(`INSERT INTO gov_hold ("kind", "targetId", "reason", "by", "at") VALUES (?, ?, ?, ?, ?)`, kind, id, "litigation", "usr_owner0001", NOW);
  assert.deepEqual(await heldFor(h.ctx, "file_versions"), { all: false, count: 0, extra: {} });
  hold("file", "fil_held0001");
  hold("thread", "thr_held0001");
  assert.deepEqual(await heldFor(h.ctx, "file_versions"), { all: false, count: 1, extra: { skipFileIds: ["fil_held0001"] } });
  assert.deepEqual(await heldFor(h.ctx, "transcripts"), { all: false, count: 1, extra: { skipThreadIds: ["thr_held0001"] } });
  hold("folder", "fld_held0001");
  assert.equal((await heldFor(h.ctx, "file_versions")).all, true, "a folder hold covers files by place, which the owner cannot answer: keep the kind whole");
  assert.equal((await heldFor(h.ctx, "transcripts")).all, false);
  hold("person", "rec_pat00001");
  for (const kind of ["transcripts", "file_versions", "run_logs", "records"] as const) assert.equal((await heldFor(h.ctx, kind)).all, true, kind);
  assert.deepEqual(await heldFor(h.ctx, "logs"), { all: false, count: 0, extra: {} }, "logs have a hold of their own in the logs module");
});
