// Flow 7, "Home says what changed", on a booted daemon with no assistant and no digest: the three reads behind Home's first line count what really changed since a time, and the sentence built from
// them names it. Noah edits a record Olivia follows, assigns her an approval, and a stranger writes to a shared mailbox; Olivia's line says so, and Noah's own line does not count his own edit.
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
import { lead, lineParts } from "../apps/app/src/places/home/sections-a/since.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const PEOPLE = ["usr_olivia", "usr_noah"];
async function boot(): Promise<Daemon> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-since-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "since", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    session: (h) => { const id = String(h["authorization"] ?? "").replace(/^Bearer /, ""); return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null; },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}
let n = 0;
const as = (d: Daemon, who: string) => async (cap: string, input: Record<string, unknown> = {}): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `hs-${cap}-${++n}`, ...input }) });
  const body = (await r.json()) as { data?: unknown };
  if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.data;
};
const lineOf = async (call: ReturnType<typeof as>, since: number): Promise<{ text: string; counts: Record<string, number> }> => {
  const activity = await call("home.activity", { since, limit: 50 });
  const inbox = await call("inbox.counts");
  const needs = await call("tasks.needs_you", { limit: 1 });
  const counts = { changes: activity.items.filter((i: { kind: string }) => i.kind === "record_change").length, unread: inbox.total, match: inbox.needsMatch, waiting: needs.total };
  const parts = lineParts(counts);
  return { text: [lead(parts, "then"), ...parts.map((p) => p.text)].join(" "), counts };
};

test("home since live: the counts behind the line match what happened, with no assistant", async () => {
  const d = await boot();
  try {
    const olivia = as(d, "usr_olivia"), noah = as(d, "usr_noah");
    const before = await lineOf(olivia, Date.now() - 60_000);
    assert.equal(lead(lineParts(before.counts), "then"), "All quiet since then.", JSON.stringify(before));

    const since = Date.now() - 1000;
    const rec = (await olivia("records.create", { type: "contact", fields: { name: "Dana Fox" } })).record;
    await olivia("follows.toggle", { resource: { type: "record", id: rec.id }, on: true });
    await noah("records.update", { type: "contact", recordId: rec.id, patch: { name: "Dana Fox-Lee" } });
    await olivia("tasks.create", { kind: "approve", title: "Approve the letter", assigned: { kind: "person", id: "usr_olivia" } });
    const box = (await olivia("mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox;
    await olivia("mail.ingest", { source: "imap", mailboxId: box.id, providerId: "p1", rfcMessageId: "<s1@x.test>", direction: "in", from: { address: "stranger@x.test" }, to: [{ address: "hello@acme.test" }], subject: "Hi", text: "Hi", receivedAt: Date.now() });
    await d.hooks?.pump?.();

    const mine = await lineOf(olivia, since);
    assert.deepEqual(mine.counts, { changes: 1, unread: 1, match: 0, waiting: 1 }, mine.text);
    assert.equal(mine.text, "Since then: 1 task waits on you 1 unread message 1 record you follow changed", "the line names all three");
    // Noah made the edit and has nothing waiting: his own edit is not news to him
    const hers = await lineOf(noah, since);
    assert.equal(hers.counts.waiting, 0);
  } finally { await d.stop(); }
});
