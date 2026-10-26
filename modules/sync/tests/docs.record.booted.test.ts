// Golden flow 15: a note is a record with a long-text field, records.create puts its row in the sync feed, and sync.doc.open / sync.doc.update work on it by the record's id, from two devices.
// The host (laptop) creates the note and writes into it, the phone opens it and sees the update, writes its own edit back, and the laptop sees that. A person with no access is refused.
// @reads /modules/sync/migrations/0001_pull.sql
// Path mapping: sits with the sync tests because it needs yjs, which host/ may not import.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import { fromB64, toB64 } from "../docs/b64.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

const LAPTOP = "tok-laptop";
const PHONE = "tok-phone";
const TESS = "tok-usr_tess";
const WHO: Record<string, { id: string; device: string }> = { [LAPTOP]: { id: "usr_olivia", device: "dev_laptop" }, [PHONE]: { id: "usr_olivia", device: "dev_phone" }, [TESS]: { id: "usr_tess", device: "dev_tess" } };

test("a note created on the host is opened on the phone, which sees the update and sends its own edit back", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "doc-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === undefined ? undefined : WHO[t];
      return who ? { space: "spc_core", principal: { kind: "person", id: who.id }, device: who.device } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (token: string, p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    const text = await r.text();
    return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
  };
  const ok = async (token: string, p: string, body: unknown): Promise<Record<string, unknown>> => {
    const r = await post(token, p, body);
    assert.equal(r.status, 200, `${p}: ${r.text}`);
    return r.data;
  };
  /** The text a document opened through sync.doc.open holds: its snapshot, then its pending updates. */
  const textOf = async (token: string, doc: string): Promise<{ text: string; y: Y.Doc }> => {
    const open = await ok(token, "/v1/sync/doc/open", { doc });
    const y = new Y.Doc();
    if (typeof open["snapshot"] === "string" && open["snapshot"] !== "") Y.applyUpdate(y, fromB64(open["snapshot"]));
    for (const u of open["updates"] as string[]) Y.applyUpdate(y, fromB64(u));
    return { text: y.getText("body").toString(), y };
  };
  try {
    // the laptop makes the note: a record of the seeded Note type, so its row reaches the sync feed
    const made = await ok(LAPTOP, "/v1/records/create", { idempotencyKey: "doc-live-note", type: "note_board", fields: { title: "Plan" } });
    const doc = (made["record"] as { id: string }).id;
    assert.match(doc, /^rec_/, "records.create made the note");

    // the laptop writes the first words
    const laptop = new Y.Doc();
    laptop.getText("body").insert(0, "hello");
    await ok(LAPTOP, "/v1/sync/doc/update", { doc, update: toB64(Y.encodeStateAsUpdate(laptop)) });

    // the phone opens the same document and sees them
    const onPhone = await textOf(PHONE, doc);
    assert.equal(onPhone.text, "hello", "the phone sees the laptop's update");

    // the phone edits and sends only its own change back
    const before = Y.encodeStateVector(onPhone.y);
    onPhone.y.getText("body").insert(5, " world");
    await ok(PHONE, "/v1/sync/doc/update", { doc, update: toB64(Y.encodeStateAsUpdate(onPhone.y, before)) });
    assert.equal((await textOf(LAPTOP, doc)).text, "hello world", "the laptop sees the phone's edit");

    // a person with no access to the note cannot open or write it
    const denied = await post(TESS, "/v1/sync/doc/open", { doc });
    assert.ok(denied.status === 403 || denied.status === 404, `a temp person is refused, got ${denied.status} ${denied.text}`);
    const nobody = await post(LAPTOP, "/v1/sync/doc/open", { doc: "rec_00000000000000000000000000000000" });
    assert.equal(nobody.status, 404, "a document that does not exist is not there");
  } finally { await d.stop(); }
});
