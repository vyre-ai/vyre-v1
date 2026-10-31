// Sealed fields on a booted daemon: the value lives in the Vault (a Space owned "Sealed fields" folder), the record keeps a reference, a person with access reveals it and is audited, a person without
// access is refused, and no file in the data directory ever holds the plaintext.
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
const SECRET = "123-45-6789";
const PEOPLE = ["usr_olivia", "usr_noah", "usr_tess"];

export async function bootSealed(dir?: string): Promise<{ d: Daemon; dir: string }> {
  let where = dir;
  if (!where) {
    const core = bootCore();
    where = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sealed-"));
    core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    fs.copyFileSync(core.file, path.join(where, "events.db"));
    core.close();
  }
  const d = await startDaemon({
    config: loadConfig(["--data-dir", where, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "sealed-live", free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${where}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    session: (h) => { const id = String(h["authorization"] ?? "").replace(/^Bearer /, ""); return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null; },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  return { d, dir: where };
}

let keys = 0;
export async function api(d: Daemon, cap: string, input: Record<string, unknown>, who = "usr_olivia"): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `sf-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>, who?: string): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(d, cap, input, who);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

/** Every file under the data directory that holds `needle` as bytes (a database, its WAL, a log). */
export function filesHolding(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && fs.readFileSync(f).includes(Buffer.from(needle))) hits.push(path.relative(dir, f));
    }
  };
  walk(dir);
  return hits;
}

export async function makeSealedType(d: Daemon, key = "client"): Promise<void> {
  const ops = [
    { op: "type.create", type: key, def: { title: "Client", plural: "Clients", icon: "table", label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "ssn", type: "sealed", title: "Tax ID" }] } },
  ];
  const preview = await ok(d, "schema.diff", { ops });
  assert.deepEqual(preview.problems, []);
  await ok(d, "schema.apply", { ops, previewToken: preview.previewToken, confirm: [] });
}

test("sealed field live: the value goes to the Vault, the record keeps a reference, the owner reveals it, a member cannot, and no file holds the plaintext", async () => {
  const { d, dir } = await bootSealed();
  try {
    await makeSealedType(d);
    const made = (await ok(d, "records.create", { type: "client", fields: { name: "Acme", ssn: { sealed: true, value: SECRET } } })).record;
    const ref = made.fields.ssn;
    assert.equal(ref.sealed, "ssn");
    assert.equal(ref.present, true);
    assert.match(ref.ref, /^vit_/);
    assert.ok(!JSON.stringify(made).includes(SECRET), "the create answer holds the reference only");
    const read = (await ok(d, "records.get", { type: "client", recordId: made.id })).record;
    assert.deepEqual(read.fields.ssn.ref, ref.ref);
    assert.ok(!JSON.stringify(read).includes(SECRET));

    // the owner reveals it, through the Vault
    const shown = await ok(d, "records.reveal", { type: "client", recordId: made.id, field: "ssn" });
    assert.equal(shown.value, SECRET);
    // a member without the Reveal permission does not
    const refused = await api(d, "records.reveal", { type: "client", recordId: made.id, field: "ssn" }, "usr_noah");
    assert.equal(refused.status, 403, `a member cannot reveal: ${JSON.stringify(refused.data)}`);
    const tess = await api(d, "records.reveal", { type: "client", recordId: made.id, field: "ssn" }, "usr_tess");
    assert.ok([403, 404].includes(tess.status), `a temp person cannot reveal: ${tess.status}`);
    assert.ok(!JSON.stringify(refused.data).includes(SECRET));

    // a new value replaces the old one in the same Vault item
    const next = (await ok(d, "records.update", { type: "client", recordId: made.id, patch: { ssn: { sealed: true, value: "987-65-4321" } } })).record;
    assert.equal(next.fields.ssn.ref, ref.ref);
    assert.equal((await ok(d, "records.reveal", { type: "client", recordId: made.id, field: "ssn" })).value, "987-65-4321");
  } finally { await d.stop(); }
  assert.deepEqual(filesHolding(dir, SECRET), [], "no file holds the first value");
  assert.deepEqual(filesHolding(dir, "987-65-4321"), [], "no file holds the second value");
});
