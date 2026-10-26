// P-CC_39: erase a person end to end on a booted daemon. The chat, telephony, inbox, mail and governance modules are made live in a copy of the code root (the flip itself waits for P-CI_02); records, memory and runs
// are live already. Everything goes through the gateway as the Space owner: the person's record, a chat and a channel, a text, a call with a recording, a mail message, their entries in the inbox, a memory
// note and a fact are seeded, governance finds them, erases them, and the stores are then searched for any trace. Another person's data is seeded in each store and must stay. A second test runs the retention
// job for Run logs and removes aged Runs through the purger. The find side that reaches modules this test does not make live (contact resolution, search, the inbox thread, the memory subject lookup) and the Files
// and Twilio calls an erase makes are answered by test handlers.
// TODO(P-CC_41): the kernel event log still holds the record's events with their payloads. When P-CC_41 lands (compaction or per-subject key shredding), add the check that no event of the erased record
// carries a field value, and un-skip the test at the end of this file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import type { Handler } from "../../../host/src/invoke.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const DAY = 86_400_000;
const WORDS = ["Pat Lee", "divorce", "secret trust", "settlement", "pat@client.example"];

/** A code root that is this repo with some modules live: every top-level entry a symlink, host/ rebuilt around an edited modules.json. */
function codeRootWith(live: string[]): string {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-coderoot-"));
  for (const name of fs.readdirSync(repo)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  for (const id of live) {
    const m = list.modules.find((x) => x.id === id);
    assert.ok(m, `host/modules.json lists ${id}`);
    m.status = "live";
  }
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-erase-booted-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

interface World { chatIds: string[]; hits: { id: string; kind: string; title: string }[]; recordId: string; transcriptPath: string; filesDeleted: string[]; filesPurged: string[] }

async function boot(world: World): Promise<Daemon> {
  const dir = seededDir();
  const notFound = Object.assign(new Error("gone"), { error: { code: "validation.not_found" } });
  const h = (fn: (ctx: unknown, input: Record<string, unknown>) => unknown): Handler => ((ctx: unknown, input: unknown) => fn(ctx, input as Record<string, unknown>)) as unknown as Handler;
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWith(["governance", "chat", "telephony", "inbox", "mail"]),
    platform: fakePlatform({
      os: "linux", hostname: "erase-booted", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    extra: {
      handlers: {
        // the find side of modules this test does not make live
        "contacts.resolve": h(() => ({ sure: [{ recordId: world.recordId, type: "rt_contact", name: "Pat Lee", via: "address", score: 1 }], unsure: [] })),
        "search.query": h((_c, i) => ({ hits: world.hits.filter((x) => (i["types"] as string[]).includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, title: x.title, link: `/x/${x.id}`, score: 1 })), tookMs: 1 })),
        "inbox.thread": h((_c, i) => ({
          conversation: { id: "cnv_pat00001", address: "pat@client.example", displayName: "Pat Lee", lastChannel: "email", lastMessageAt: 1, lastPreview: "", unreadCount: 0, followed: false, alertOnReplies: false, mailboxIds: [], needsMatch: false, contactId: i["contactId"] },
          items: [{ at: 1, id: "eml_pat00001", kind: "email" }, { at: 2, id: "sms_pat00001", kind: "sms" }, { at: 3, id: "cal_pat00001", kind: "call" }],
        })),
        "memory.find_by_subject": h(() => ({
          facts: [{ factId: "fct_pat00001", layer: "agent", ownerRef: "agt_intake01", text: "(not shown)", validFrom: 1, learnedAt: 1, sourceKind: "chat", sourceRef: "thr_x", status: "current" }],
          notes: [{ noteId: "not_pat00001", layer: "agent", path: "x.md", title: "Note", updatedAt: 1 }],
        })),
        // what an erase asks of Files and Twilio
        "files.resolve": h((_c, i) => { if (i["path"] !== world.transcriptPath) throw notFound; return { kind: "file", fileId: "fil_trans0001" }; }),
        "files.delete": h((_c, i) => { world.filesDeleted.push(String(i["fileId"])); return { deleted: true }; }),
        "files.purge": h((_c, i) => { world.filesPurged.push(String(i["fileId"])); return { purged: true }; }),
        "twilio.recording.delete": h(() => ({ deleted: true })),
      },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
}

const post = (d: Daemon, p: string, body: unknown) => fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
async function ok<T>(d: Daemon, p: string, body: unknown): Promise<T> {
  const r = await post(d, p, body);
  const text = await r.text();
  assert.equal(r.status, 200, `${p}: ${text.slice(0, 400)}`);
  return (JSON.parse(text) as { data: T }).data;
}

const CONTACT = {
  op: "type.create", type: "rt_contact",
  def: { title: "Contact", plural: "Contacts", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "text", title: "Email" }] },
};

/** Every row of every table of the host database whose name starts with one of the prefixes, as one string. */
function dumpOf(d: Daemon, prefixes: string[]): string {
  const tables = (d.db!.all("SELECT name FROM sqlite_master WHERE type = 'table'") as { name: string }[]).map((t) => t.name).filter((n) => prefixes.some((p) => n.startsWith(p)));
  return JSON.stringify(tables.map((t) => [t, d.db!.all(`SELECT * FROM "${t}"`)]));
}

test("erase a person end to end: found in every store, erased, and nothing of theirs is left; another person's data stays", async () => {
  const world: World = { chatIds: [], hits: [], recordId: "", transcriptPath: "", filesDeleted: [], filesPurged: [] };
  const d = await boot(world);
  try {
    const run = (sql: string, ...a: unknown[]) => d.db!.run(sql, ...a);
    // ---- seed: records through the gateway
    await ok(d, "/v1/schema/apply", { idempotencyKey: "erase-type", ops: [CONTACT] });
    const pat = (await ok<{ record: { id: string } }>(d, "/v1/records/create", { idempotencyKey: "erase-pat", type: "rt_contact", fields: { name: "Pat Lee", email: "pat@client.example" } })).record.id;
    const other = (await ok<{ record: { id: string } }>(d, "/v1/records/create", { idempotencyKey: "erase-other", type: "rt_contact", fields: { name: "Dana Other", email: "dana@other.example" } })).record.id;
    world.recordId = pat;
    // ---- chats and a channel
    const chat = (await ok<{ thread: { threadId: string } }>(d, "/v1/chat/start", { idempotencyKey: "erase-chat", kind: "chat", agentIds: ["agt_intake01"], first: "Pat Lee is going through a divorce" })).thread.threadId;
    const keepChat = (await ok<{ thread: { threadId: string } }>(d, "/v1/chat/start", { idempotencyKey: "erase-chat2", kind: "chat", agentIds: ["agt_intake01"], first: "Lunch on Friday" })).thread.threadId;
    const channel = (await ok<{ channel: { channelId: string } }>(d, "/v1/channels/create", { idempotencyKey: "erase-chn", name: "Pat Lee matter", visibility: "invite", agentIds: ["agt_intake01"] })).channel.channelId;
    world.transcriptPath = `chats/${chat}/transcript.md`;
    world.hits.push({ id: chat, kind: "chat", title: "Pat Lee" }, { id: channel, kind: "channel", title: "Pat Lee matter" });
    // ---- a text, a call with a recording, a mail message, their inbox entries
    for (const [id, who, body] of [["sms_pat00001", "+14155550177", "call me back about the divorce"], ["sms_other001", "+14155550188", "see you at noon"]] as const) {
      run(`INSERT INTO telephony_sms ("id", "numberId", "direction", "from", "to", "body", "status", "at", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "num_a1b2c3", "in", who, "+14155550100", body, "delivered", 1, 0);
    }
    for (const [id, file, text] of [["cal_pat00001", "fil_rec00001", "Pat: I want to change my secret trust"], ["cal_other001", null, "Dana: hello"]] as const) {
      run(`INSERT INTO telephony_call ("id", "numberId", "direction", "from", "to", "state", "startedAt", "recordingFileId", "transcript", "summary", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "num_a1b2c3", "in", "+14155550177", "+14155550100", "ended", 1, file, text, text, 0);
      run(`INSERT INTO telephony_call_meta ("callId", "hold", "recording", "recordingSid") VALUES (?, ?, ?, ?)`, id, 0, 0, file ? "RE00000000000000000000000000000001" : null);
    }
    for (const [id, subject, body] of [["eml_pat00001", "Pat Lee settlement", "The settlement terms are attached"], ["eml_other001", "Lunch", "Noon works"]] as const) {
      run(`INSERT INTO mail_message ("id", "mailboxId", "direction", "status", "fromAddress", "toAddresses", "subject", "snippet", "body", "sentAt", "attachments", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "mbx_work0001", "in", "received", "pat@client.example", "[]", subject, body, body, 1, "[]", 0);
      run(`INSERT INTO mail_body ("messageId", text) VALUES (?, ?)`, id, body);
    }
    run(`INSERT INTO inbox_conversation ("id", "contactId", "address", "displayName", "lastMessageAt", "lastChannel", "lastPreview", "unreadCount", "needsMatch", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "cnv_pat00001", pat, "pat@client.example", "Pat Lee", 3, "call", "Pat: I want to change my secret trust", 3, 0, 0);
    for (const [id, kind, preview, at] of [["eml_pat00001", "email", "The settlement terms are attached", 1], ["sms_pat00001", "sms", "call me back about the divorce", 2], ["cal_pat00001", "call", "Pat: I want to change my secret trust", 3]] as const) {
      run(`INSERT INTO inbox_item ("id", "conversationId", "kind", "refId", "address", "direction", "at", "preview", "unread") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, `${kind}:${id}`, "cnv_pat00001", kind, id, "pat@client.example", "in", at, preview, 1);
    }
    // ---- memory: a note and a fact about Pat, and ones that are not
    for (const [note, file, title, body] of [["not_pat00001", "fil_note0001", "Pat Lee trust", "Pat has a secret trust"], ["not_other001", "fil_note0002", "Handbook", "Start here"]] as const) {
      run(`INSERT INTO memory_notes (note_id, file_id, path, title, layer, owner_ref, agent_id, area, body, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, note, file, `Agents/Intake/memory/notes/${title}.md`, title, "agent", "agt_intake01", "agt_intake01", "notes", body, 1);
    }
    for (const [id, text] of [["fct_pat00001", "Pat Lee has a secret trust"], ["fct_other001", "The office closes at five"]] as const) {
      run(`INSERT INTO memory_facts (id, layer, owner_ref, agent_id, text, enc, valid_from, learned_at, source_kind, source_ref, source_person, proposed_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "agent", "agt_intake01", "agt_intake01", text, 0, 1, 1, "chat", "thr_x", "usr_olivia", "usr_olivia", "current");
    }
    assert.ok(WORDS.some((w) => dumpOf(d, ["chat_", "telephony_", "inbox_", "mail_", "memory_"]).includes(w)), "the seed is in the stores before the erase");

    // ---- find, then erase
    const found = await ok<{ findingId: string; groups: { kind: string; count: number }[] }>(d, "/v1/governance/erase/find", { subject: { email: "pat@client.example" } });
    const count = (kind: string): number => found.groups.find((g) => g.kind === kind)?.count ?? -1;
    assert.deepEqual([count("records"), count("chats"), count("inbox"), count("mail"), count("calls"), count("memory")], [1, 2, 1, 1, 1, 2], "every store has something of Pat's in the finding");
    const done = await ok<{ runId: string }>(d, "/v1/governance/erase/apply", { findingId: found.findingId, include: ["records", "chats", "inbox", "mail", "calls", "memory"], idempotencyKey: "erase-apply" });
    assert.match(done.runId, /^run_/);

    // ---- nothing of theirs is left anywhere
    const gone = await post(d, "/v1/records/get", { type: "rt_contact", recordId: pat });
    assert.equal(gone.status, 404, "the record is not readable, trash included");
    assert.equal((await post(d, "/v1/records/get", { type: "rt_contact", recordId: other })).status, 200, "the other person's record stays");
    const left = dumpOf(d, ["chat_", "telephony_", "inbox_", "mail_", "memory_", "governance_"]);
    for (const w of WORDS) assert.ok(!left.includes(w), `no row in any store holds "${w}"`);
    const ids = (sql: string): string[] => (d.db!.all(sql) as { id: string }[]).map((r) => r.id).sort();
    assert.deepEqual(ids("SELECT id FROM chat_thread WHERE kind IN ('chat', 'channel')").filter((i) => i === chat || i === keepChat), [keepChat], "Pat's chat is gone, the other chat stays");
    assert.deepEqual(ids("SELECT id FROM chat_channel"), [], "the channel is gone");
    assert.deepEqual(ids("SELECT id FROM telephony_sms"), ["sms_other001"]);
    assert.deepEqual(ids("SELECT id FROM telephony_call"), ["cal_other001"]);
    assert.deepEqual(ids("SELECT id FROM mail_message"), ["eml_other001"]);
    assert.deepEqual((d.db!.all("SELECT refId FROM inbox_item") as { refId: string }[]).map((r) => r.refId), [], "Pat's three inbox entries are gone");
    assert.deepEqual((d.db!.all("SELECT note_id FROM memory_notes") as { note_id: string }[]).map((r) => r.note_id), ["not_other001"]);
    assert.deepEqual(ids("SELECT id FROM memory_facts"), ["fct_other001"]);
    assert.ok(world.filesDeleted.includes("fil_trans0001") && world.filesPurged.includes("fil_trans0001"), "the chat's transcript file was deleted and purged with it");
    // governance kept ids and counts only
    const tomb = await ok<{ total: number }>(d, "/v1/governance/tombstones/list", {});
    assert.ok(tomb.total >= 7, "a tombstone for every erased item, so a restore erases them again");
  } finally { await d.stop(); }
});

test("retention removes aged Run logs through the purger and keeps the young and the unfinished", async () => {
  const world: World = { chatIds: [], hits: [], recordId: "rec_none00001", transcriptPath: "", filesDeleted: [], filesPurged: [] };
  const d = await boot(world);
  try {
    const now = Date.now();
    const run = (id: string, status: string, endedAt: number | null, secret: string | null) => {
      d.db!.run(`INSERT INTO runs_items ("id", "kind", "name", "owner", "started_by", "status", "started_at", "ended_at", "version") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, "other", "job", "usr_olivia", "usr_olivia", status, now - 200 * DAY, endedAt, 0);
      d.db!.run(`INSERT INTO runs_steps ("run_id", "step", "attempt", "ord", "state", "input_json", "idem_key") VALUES (?, ?, ?, ?, ?, ?, ?)`, id, "send", 1, 1, "succeeded", secret ? JSON.stringify({ note: secret }) : null, `${id}:send:1`);
    };
    run("run_old000001", "succeeded", now - 150 * DAY, "the divorce file");
    run("run_old000002", "failed", now - 120 * DAY, null);
    run("run_young0001", "succeeded", now - 5 * DAY, null);
    run("run_active001", "running", null, null);
    const started = await ok<{ runId: string }>(d, "/v1/governance/jobs/run_now", { kind: "run_logs", idempotencyKey: "retention-run-logs" });
    assert.match(started.runId, /^run_/);
    const ids = (d.db!.all("SELECT id FROM runs_items WHERE id LIKE 'run_old%' OR id LIKE 'run_young%' OR id LIKE 'run_active%'") as { id: string }[]).map((r) => r.id).sort();
    assert.deepEqual(ids, ["run_active001", "run_young0001"], "the Runs past 90 days are gone, the young and the unfinished stay");
    assert.ok(!dumpOf(d, ["runs_"]).includes("divorce"), "their step logs went with them");
  } finally { await d.stop(); }
});

test.todo("the event log keeps no field value of the erased record (P-CC_41: compaction or per-subject key shredding)");
