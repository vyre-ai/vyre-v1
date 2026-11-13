// Per-person state on a booted server (P2): the Inbox's first start reads the Space's people through a real nested access.principals.list and finishes its backfill, a mail that arrives is counted for
// every person who can open the shared mailbox, one person's read is theirs alone, and a real access change (the mailbox made private) takes the conversation out of the other person's list and badge.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const PEOPLE = ["usr_olivia", "usr_noah"];
async function boot(): Promise<Daemon> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-inboxstate-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux",
      hostname: "inboxstate",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const id = String(h["authorization"] ?? "").replace(/^Bearer /, "");
      return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}
let n = 0;
const as =
  (d: Daemon, who: string) =>
  async (cap: string, input: unknown): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
      body: JSON.stringify({ idempotencyKey: `ev-${cap}-${++n}`, ...(input as object) }),
    });
    const body = (await r.json()) as { data?: unknown; error?: { message?: string } };
    if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${JSON.stringify(body).slice(0, 900)}`);
    return body.data;
  };

test("inbox state live: backfill at start, a count for each person who can open the mailbox, and a real change of role takes the conversation out of that person's badge", async () => {
  const d = await boot();
  try {
    const olivia = as(d, "usr_olivia"),
      noah = as(d, "usr_noah");
    // the Inbox's module-start job: a Space with nothing in its Inbox finishes at once, but only if it can read who the people are (the real nested call, made as the server)
    await d.startupWork();
    await d.hooks!.runPeriodic("inbox.state_backfill");
    assert.equal(
      d.db!.all(`SELECT 1 FROM inbox_flag WHERE "key" = 'state_backfill'`).length,
      1,
      "the backfill ran: it read the list of people",
    );
    const box = (
      await olivia("mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })
    ).mailbox;
    const scope = `mailbox:${box.id}`;
    const landed = await olivia("mail.ingest", {
      source: "imap",
      mailboxId: box.id,
      providerId: "p1",
      rfcMessageId: "<s1@x.test>",
      direction: "in",
      from: { address: "stranger@x.test", name: "Sam" },
      to: [{ address: "hello@acme.test" }],
      subject: "Hello there",
      text: "Hi",
      receivedAt: Date.now(),
    });
    const badge = (person: string) =>
      d.db!.all(`SELECT things, entries FROM state_count WHERE person = ? AND scope_type = 'mailbox'`, person).map((r) => ({ ...(r as object) }));
    for (const who of ["usr_olivia", "usr_noah"])
      assert.deepEqual(badge(who), [{ things: 1, entries: 1 }], `${who} has it, through the real list of people and each person's own access`);
    assert.deepEqual((await olivia("state.counts", { scopes: [scope] })).counts, [{ scope, things: 1, entries: 1 }]);
    // Noah reads it: it is read for Noah only
    await noah("inbox.mark_read", { conversationId: landed.conversationId, read: true });
    assert.deepEqual(badge("usr_noah"), [{ things: 0, entries: 0 }]);
    assert.deepEqual(badge("usr_olivia"), [{ things: 1, entries: 1 }]);
    // his state events are his: Olivia, the Space owner, reads none of them
    const noahEvents = (await olivia("events.list", { types: ["state.*"] })).events.filter(
      (e: { payload: { person?: string } }) => e.payload.person === "usr_noah",
    );
    assert.deepEqual(noahEvents, []);
    // a real access change: Noah has a message from the stranger he has not read, then loses his role
    await olivia("mail.ingest", {
      source: "imap",
      mailboxId: box.id,
      providerId: "p2",
      rfcMessageId: "<s2@x.test>",
      direction: "in",
      from: { address: "stranger@x.test", name: "Sam" },
      to: [{ address: "hello@acme.test" }],
      subject: "Hello again",
      text: "Hi again",
      receivedAt: Date.now() + 1,
    });
    assert.deepEqual(badge("usr_noah"), [{ things: 1, entries: 1 }]);
    const roles = (await olivia("access.roles.list", {})).roles as { id: string; name: string }[];
    const member = roles.find((r) => r.id === "rol_member")!;
    await olivia("access.roles.unassign", { subject: { kind: "person", id: "usr_noah" }, roleId: member.id });
    await d.hooks!.pump();
    assert.deepEqual(
      d.db!.all(`SELECT hidden FROM state_person WHERE person = 'usr_noah'`).map((r) => (r as { hidden: number }).hidden),
      [1],
      "the consumer hid his row at once",
    );
    assert.deepEqual(badge("usr_noah"), [{ things: 0, entries: 0 }], "and his badge stopped counting it");
    assert.deepEqual(badge("usr_olivia"), [{ things: 1, entries: 2 }], "Olivia's is untouched");
    // and when the role comes back, so does the conversation, with nothing unread
    await olivia("access.roles.assign", { subject: { kind: "person", id: "usr_noah" }, roleId: member.id });
    await d.hooks!.pump();
    assert.deepEqual(
      d.db!.all(`SELECT hidden, unread FROM state_person WHERE person = 'usr_noah'`).map((r) => ({ ...(r as object) })),
      [{ hidden: 0, unread: 0 }],
    );
  } finally {
    await d.stop();
  }
});
