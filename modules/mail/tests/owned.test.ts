// What a person owns in Mail, for the removal wizard (P-L7_21): their mailbox connections; revoking ends them and keeps the mail. Real SQLite with the module's own tables.
// @reads /modules/mail/migrations/0001_mail_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { hostCalls } from "../impl.ts";

const sql = readFileSync(new URL("../migrations/0001_mail_core.sql", import.meta.url), "utf8");
const statements = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(";").map((x) => x.trim()).filter((x) => x.length > 0);

function db() {
  const host = ProjectionHost.open({ path: ":memory:", space: "spc_t", projections: [] });
  for (const st of statements) host.tx.run(st);
  host.tx.run(`INSERT INTO mail_mailbox (id, kind, address, title, "ownerId", state, "connectionId", paused, version) VALUES ('mbx_pat', 'personal', 'pat@example.test', 'Pat', 'usr_pat', 'syncing', 'con_1', 0, 0)`);
  host.tx.run(`INSERT INTO mail_mailbox (id, kind, address, title, "ownerId", state, "connectionId", paused, version) VALUES ('mbx_done', 'personal', 'old@example.test', 'Old', 'usr_pat', 'disconnected', NULL, 1, 0)`);
  host.tx.run(`INSERT INTO mail_mailbox (id, kind, address, title, "ownerId", state, "connectionId", paused, version) VALUES ('mbx_maya', 'personal', 'maya@example.test', 'Maya', 'usr_maya', 'syncing', 'con_2', 0, 0)`);
  const ctx = { now: () => 1_760_000_000_000, db: { all: (q: string, ...a: unknown[]) => host.tx.all(q, ...a), run: (q: string, ...a: unknown[]) => ({ changes: Number(host.tx.run(q, ...a).changes) }) } };
  return { host, ctx };
}

test("owned_by lists the connected mailboxes of the person, not a disconnected one or someone else's", () => {
  const { ctx } = db();
  const out = hostCalls["mail.owned_by"](ctx, { person: "usr_pat" });
  assert.deepEqual(out.mailbox_connections.ids, ["mbx_pat"]);
  assert.deepEqual(out.mailbox_connections.sample, [{ type: "mailbox", id: "mbx_pat", title: "Pat" }]);
});

test("revoke disconnects them and drops the connection; other kinds and actions touch nothing; the other person's mailbox stays", () => {
  const { host, ctx } = db();
  assert.equal(hostCalls["mail.reassign_owned"](ctx, { person: "usr_pat", kind: "files", action: "revoke" }), 0);
  assert.equal(hostCalls["mail.reassign_owned"](ctx, { person: "usr_pat", kind: "mailbox_connections", action: "reassign" }), 0);
  assert.equal(hostCalls["mail.reassign_owned"](ctx, { person: "usr_pat", kind: "mailbox_connections", action: "revoke" }), 1);
  const row = host.tx.all<{ state: string; connectionId: string | null; paused: number }>(`SELECT state, "connectionId", paused FROM mail_mailbox WHERE id = 'mbx_pat'`)[0]!;
  assert.deepEqual([row.state, row.connectionId, row.paused], ["disconnected", null, 1]);
  assert.equal(host.tx.all<{ state: string }>(`SELECT state FROM mail_mailbox WHERE id = 'mbx_maya'`)[0]!.state, "syncing");
  assert.deepEqual(hostCalls["mail.owned_by"](ctx, { person: "usr_pat" }).mailbox_connections.ids, []);
});
