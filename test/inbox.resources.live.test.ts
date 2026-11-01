// Conversations and mail messages are resources in access: the first call that names one answers (the owner and a Member both read a shared mailbox's mail by id and by thread), where it used to
// answer "not found" to everyone because nothing registered them.
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const PEOPLE = ["usr_olivia", "usr_noah"];
async function boot(): Promise<Daemon> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-inboxres-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "inboxres", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    session: (h) => { const id = String(h["authorization"] ?? "").replace(/^Bearer /, ""); return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null; },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}
let n = 0;
const as = (d: Daemon, who: string) => async (cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `ev-${cap}-${++n}`, ...(input as object) }) });
  const body = (await r.json()) as { data?: unknown; error?: { message?: string } };
  if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.data;
};

test("inbox resources live: a shared mailbox's message and conversation open by id and by thread for the owner and for a Member", async () => {
  const d = await boot();
  try {
    const olivia = as(d, "usr_olivia"), noah = as(d, "usr_noah");
    const box = (await olivia("mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox;
    const landed = await olivia("mail.ingest", { source: "imap", mailboxId: box.id, providerId: "p1", rfcMessageId: "<s1@x.test>", direction: "in", from: { address: "stranger@x.test", name: "Sam" }, to: [{ address: "hello@acme.test" }], subject: "Hello there", text: "Hi", receivedAt: Date.now() });
    for (const who of [olivia, noah]) {
      assert.equal((await who("mail.message.get", { messageId: landed.messageId })).message.subject, "Hello there");
      assert.equal((await who("inbox.thread", { conversationId: landed.conversationId })).conversation.id, landed.conversationId);
      await who("inbox.mark_read", { conversationId: landed.conversationId, read: true });
    }
  } finally { await d.stop(); }
});
