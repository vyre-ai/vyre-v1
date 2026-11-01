// @tsx
// Flow 6, "A record shows everything", on a booted daemon: the Everything feed is made of ordinary reads as the person, so it must show a Member what they may read and nothing of what they may not:
// the owner's private chat about the record and the owner's private mailbox are in the owner's feed and absent from a Member's.
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
import { loadEverything } from "../apps/app/src/places/records/recordpane/everything.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const PEOPLE = ["usr_olivia", "usr_noah"];
async function boot(): Promise<Daemon> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-everything-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "everything", free: 80e9, commands: {
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
const names = (id: string): string => id;

test("everything live: the owner sees the comment, task, private chat and shared mail; a Member sees the comment and shared mail, never the private chat or private mail", async () => {
  const d = await boot();
  try {
    const olivia = as(d, "usr_olivia"), noah = as(d, "usr_noah");
    const rec = (await olivia("records.create", { type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test" } })).record;
    await olivia("records.comments.add", { type: "contact", recordId: rec.id, text: "Dana wants the Friday slot", mentions: [] });
    await olivia("tasks.create", { title: "Call Dana back", assigned: { kind: "person", id: "usr_olivia" }, recordId: rec.id });
    // a chat only Olivia and her assistant are in, about this record
    await olivia("chat.start", { kind: "chat", agentIds: ["agt_helper"], recordId: rec.id, title: "Private notes on Dana" });
    // Dana's addresses: a shared mailbox gets her mail into the record's history; a mailbox that is Olivia's alone keeps it out of everyone's history, hers included
    await olivia("contacts.address.add", { contactId: rec.id, kind: "email", value: "dana@fox.test" });
    const shared = (await olivia("mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox;
    const private_ = (await olivia("mail.mailbox.create", { kind: "shared", address: "olivia-private@acme.test", title: "Mine", privacy: "private" })).mailbox;
    const ingest = (mailboxId: string, to: string, subject: string, n: number) => olivia("mail.ingest", { source: "imap", mailboxId, providerId: `p${n}`, rfcMessageId: `<d${n}@fox.test>`, direction: "in", from: { address: "dana@fox.test", name: "Dana Fox" }, to: [{ address: to }], subject, text: "Hello", receivedAt: Date.now() });
    assert.equal((await ingest(shared.id, "hello@acme.test", "Friday works", 1)).linked, "sure");
    await ingest(private_.id, "olivia-private@acme.test", "Private: my fee", 2);
    await d.hooks?.pump?.();

    const feed = (who: ReturnType<typeof as>) => loadEverything({ call: who, type: "contact", recordId: rec.id, names, folderOf: async () => null });
    const mineFeed = await feed(olivia);
    const kinds = (items: typeof mineFeed): string[] => items.map((i) => `${i.kind}:${i.title}`);
    assert.ok(kinds(mineFeed).some((k) => k === "comment:Dana wants the Friday slot"), kinds(mineFeed).join(" | "));
    assert.ok(kinds(mineFeed).some((k) => k === "task:Call Dana back"), "the task");
    assert.ok(kinds(mineFeed).some((k) => k === "chat:Private notes on Dana"), "the private chat is in the owner's feed");
    console.log("DBG", kinds(mineFeed).join(" | "), JSON.stringify(await olivia("inbox.thread", { contactId: rec.id })).slice(0, 700));
    assert.ok(kinds(mineFeed).some((k) => k === "mail:Friday works"), "the shared mailbox's mail is in the history");
    assert.ok(!kinds(mineFeed).some((k) => k.includes("Private: my fee")), "private mail never joins a record's history, not even the owner's");

    const theirs = kinds(await feed(noah));
    assert.ok(theirs.some((k) => k === "comment:Dana wants the Friday slot"), "a Member reads the record's comments");
    assert.ok(!theirs.some((k) => k.startsWith("chat:")), `no private chat for a Member: ${theirs.join(" | ")}`);
    assert.ok(theirs.some((k) => k === "mail:Friday works"), "a Member reads the shared mailbox's history");
    assert.ok(!theirs.some((k) => k.includes("Private: my fee")), `no private mail for a Member: ${theirs.join(" | ")}`);
  } finally { await d.stop(); }
});
