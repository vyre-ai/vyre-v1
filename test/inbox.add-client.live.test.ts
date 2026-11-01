// Flow 5, "Mail becomes a client file", on a booted daemon: a message with two attachments arrives from an unknown sender; one tap (inbox.match_new with the two extras, as the person) makes the contact,
// links the conversation, files the attachments in the record's folder and puts a Reply task on the person's list. The person is a Member, to prove the files access works for someone who is not an owner.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-addclient-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "add-client", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    session: (h) => { const id = String(h["authorization"] ?? "").replace(/^Bearer /, ""); return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null; },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}
async function call(d: Daemon, cap: string, input: Record<string, unknown>, who: string): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

let n = 0;
const as = async (d: Daemon, who: string, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ac-${cap}-${++n}`, ...input }, who);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const blob = async (d: Daemon, text: string): Promise<string> => {
  const bytes = Buffer.from(text);
  const slot = await as(d, "usr_olivia", "files.upload_url", { size: bytes.length, mime: "text/plain" });
  await d.hooks!.call("files.put_upload", { blobId: slot.blobId, token: new URL(slot.url, "http://vyred").searchParams.get("token"), base64: bytes.toString("base64") });
  return slot.blobId as string;
};

test("add as a client: the contact, the linked conversation, both attachments in its folder, and a Reply task for the person", async () => {
  const d = await boot();
  try {
    const box = (await as(d, "usr_olivia", "mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox;
    const ingested = await as(d, "usr_olivia", "mail.ingest", {
      source: "imap", mailboxId: box.id, providerId: "prov-1", rfcMessageId: "<dana-1@fox.test>", direction: "in", from: { address: "dana@fox.test", name: "Dana Fox" }, to: [{ address: "hello@acme.test" }], subject: "Engagement papers",
      text: "Please find my ID and the signed letter attached.", receivedAt: Date.now(), attachments: [
        { name: "id.txt", mime: "text/plain", size: 8, blobId: await blob(d, "ID PAPER") }, { name: "letter.txt", mime: "text/plain", size: 11, blobId: await blob(d, "SIGNED LETT") },
      ],
    }) as { messageId: string; linked: string; conversationId: string };
    assert.equal(ingested.linked, "none", "a stranger stays unmatched");
    assert.ok(ingested.conversationId);
    await d.hooks?.pump?.();

    // the person taps Add as a client (a Member: the files access must come from the record, not from owning the Space)
    const done = await as(d, "usr_noah", "inbox.match_new", { conversationId: ingested.conversationId, type: "contact", name: "Dana Fox", fileAttachments: true, replyTask: true });
    assert.equal(done.filed, 2, JSON.stringify(done));
    assert.equal(done.skipped, 0);
    assert.match(done.taskId, /^tsk_/);
    assert.equal(done.conversation.contactId, done.recordId);

    const folder = (await as(d, "usr_noah", "projects.files_folder", { type: "contact", recordId: done.recordId, create: false })).folderId as string;
    assert.ok(folder, "the record has a folder");
    const files = (await as(d, "usr_noah", "files.list", { folder })).files as Array<{ name: string }>;
    assert.deepEqual(files.map((f) => f.name).sort(), ["id.txt", "letter.txt"]);

    const task = (await as(d, "usr_noah", "tasks.get", { taskId: done.taskId })).task;
    assert.equal(task.title, "Reply to Dana Fox");
    assert.deepEqual(task.assigned, { kind: "person", id: "usr_noah" });
    assert.equal(task.recordId, done.recordId);

    // a second tap changes nothing: the conversation is matched already
    const again = await call(d, "inbox.match_new", { idempotencyKey: "ac-again", conversationId: ingested.conversationId, type: "contact", fileAttachments: true, replyTask: true }, "usr_noah");
    assert.notEqual(again.status, 200);
  } finally { await d.stop(); }
});
