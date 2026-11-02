// The Campaigns product left: an existing Space keeps every unsubscribe link already in someone's inbox, loses the tables, keeps its mail and texts, and a Space that never had Campaigns migrates too.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/daemon/sqlite.ts";
import { migrate } from "../src/daemon/hosttables.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AFTER = new Map([
  ["mail", "0003_unsubscribe.sql"], ["gate", "0004_campaign_launch_removed.sql"], ["runs", "0004_campaign_runs_removed.sql"], ["notifications", "0003_campaign_reply_removed.sql"],
  ["scheduler-api", "0002_campaigns_removed.sql"], ["settings", "0002_text_window.sql"], ["inbox", "0003_campaign_removed.sql"], ["telephony", "0002_campaign_removed.sql"],
]);

/** A code root holding every migration from before this change, as a Space that booted then ran them. */
function oldRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-oldmig-"));
  for (const id of fs.readdirSync(path.join(ROOT, "modules"))) {
    const from = path.join(ROOT, "modules", id, "migrations");
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.join(root, "modules", id, "migrations"), { recursive: true });
    for (const f of fs.readdirSync(from)) if (!(AFTER.has(id) && f >= (AFTER.get(id) as string))) fs.copyFileSync(path.join(from, f), path.join(root, "modules", id, "migrations", f));
  }
  return root;
}

const OLD_CAMPAIGNS = `
  CREATE TABLE campaigns_campaign (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE campaigns_step (campaign_id TEXT NOT NULL, key TEXT NOT NULL);
  CREATE TABLE campaigns_variant (campaign_id TEXT NOT NULL, key TEXT NOT NULL);
  CREATE TABLE campaigns_member (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL);
  CREATE TABLE campaigns_send (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL);
  CREATE TABLE campaigns_reply (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL);
  CREATE TABLE campaigns_unsub (token_hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, member_id TEXT NOT NULL, address TEXT NOT NULL, used_at INTEGER);
  CREATE TABLE campaigns_warmup (mailbox_id TEXT PRIMARY KEY, stage TEXT NOT NULL);
  CREATE TABLE campaigns_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO campaigns_campaign VALUES ('cmp_spring', 'Spring');
  INSERT INTO campaigns_unsub VALUES ('hash_open', 'cmp_spring', 'mem_1', 'dana@fox.test', NULL), ('hash_used', 'cmp_spring', 'mem_2', 'lee@acme.test', 7);
`;
const all = (db: ReturnType<typeof openDb>, sql: string): unknown[] => JSON.parse(JSON.stringify(db.all(sql))) as unknown[];
const tables = (db: ReturnType<typeof openDb>, like: string): string[] => (db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?", like) as { name: string }[]).map((r) => r.name);
const columns = (db: ReturnType<typeof openDb>, t: string): string[] => (db.all(`PRAGMA table_info(${t})`) as { name: string }[]).map((c) => c.name);

test("a Space that ran Campaigns keeps its links, drops the tables, and open work ends; finished history stays", () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mig-")), "modules.db"));
  try {
    migrate(db, oldRoot(), () => 1);
    db.exec(OLD_CAMPAIGNS);
    db.exec(`
      INSERT INTO mail_message (id, "mailboxId", "campaignId", subject) VALUES ('eml_1', 'mbx_1', 'cmp_spring', 'Hello');
      INSERT INTO gate_holds (id, act, cap_name, cap_version, input, input_hash, payload_hash, principal_kind, principal_id, decision_id, task_id, state, summary, approver, rule, created_at, expires_at)
        VALUES ('hld_1', 'campaign_launch', 'campaigns.launch', 1, '{}', 'h', 'p', 'person', 'usr_1', 'dec_1', 'tsk_1', 'held', 's', 'a', 'r', 1, 2);
      INSERT INTO runs_items (id, kind, status, updated_at) VALUES ('run_open', 'campaign', 'running', 5), ('run_done', 'campaign', 'succeeded', 5);
      INSERT INTO notifications_items (id, person, kind) VALUES ('ntf_1', 'usr_1', 'campaign.reply'), ('ntf_2', 'usr_1', 'run.failed');
    `);
    db.exec(`
      INSERT INTO settings_value (setting, scope, person, value, updated_at) VALUES ('mail.send_window', 'space', '', '{"days":[1],"startHour":9,"endHour":10,"zone":"space"}', 1), ('mail.sender_caps', 'space', '', '{"perHour":5,"perDay":9}', 1), ('mail.throttle', 'space', '', '{"perMinute":1}', 1);
    `);
    const ran = migrate(db, ROOT, () => 2).map((m) => `${m.module}/${m.file}`);
    assert.ok(ran.includes("mail/0004_campaigns_removed.sql"), ran.join(", "));
    assert.deepEqual(tables(db, "campaigns_%"), []);
    assert.deepEqual(all(db, "SELECT token_hash, address, used_at FROM mail_unsub ORDER BY token_hash"), [
      { token_hash: "hash_open", address: "dana@fox.test", used_at: null }, { token_hash: "hash_used", address: "lee@acme.test", used_at: 7 },
    ], "every link sent keeps working, and a used one stays used");
    assert.equal(tables(db, "mail_send_log").length, 0);
    assert.ok(!columns(db, "mail_message").includes("campaignId"));
    assert.ok(!columns(db, "inbox_item").includes("campaignId") && !columns(db, "inbox_conversation").includes("campaignId") && !columns(db, "telephony_sms").includes("campaignId"));
    assert.deepEqual(all(db, "SELECT id, subject FROM mail_message"), [{ id: "eml_1", subject: "Hello" }], "the mail itself stays");
    assert.deepEqual(all(db, "SELECT state FROM gate_holds"), [{ state: "expired" }]);
    assert.deepEqual(all(db, "SELECT id, status FROM runs_items ORDER BY id"), [{ id: "run_done", status: "succeeded" }, { id: "run_open", status: "stopped" }]);
    assert.deepEqual(all(db, "SELECT id FROM notifications_items"), [{ id: "ntf_2" }]);
    assert.deepEqual(all(db, "SELECT setting, value FROM settings_value ORDER BY setting"), [
      { setting: "telephony.send_window", value: '{"days":[1],"startHour":9,"endHour":10,"zone":"space"}' }, { setting: "telephony.sender_caps", value: '{"perHour":5,"perDay":9}' },
    ].sort((a, b) => (a.setting < b.setting ? -1 : 1)), "a value a Space chose keeps working under the text names");
    assert.deepEqual(migrate(db, ROOT, () => 3), [], "the next boot runs nothing");
  } finally { db.close(); }
});

test("a new Space runs every migration and never holds a campaign table", () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mig-")), "modules.db"));
  try {
    migrate(db, ROOT, () => 1);
    assert.deepEqual(tables(db, "campaigns%"), []);
    assert.equal(tables(db, "mail_unsub").length, 1);
    assert.ok(!columns(db, "mail_message").includes("campaignId"));
  } finally { db.close(); }
});
