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

// ---------------------------------------------------------------- sealing a field that already holds values

test("seal this field live: 50 plaintext values move into the Vault, the apply says it is one way, the record page shows references, and no file holds a value", async () => {
  const { d, dir } = await bootSealed();
  const values = Array.from({ length: 50 }, (_, i) => `TAX-${String(1000 + i)}-PLAIN`);
  try {
    const ops0 = [{ op: "type.create", type: "client", def: { title: "Client", plural: "Clients", icon: "table", label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "taxid", type: "text", title: "Tax ID" }] } }];
    const p0 = await ok(d, "schema.diff", { ops: ops0 });
    await ok(d, "schema.apply", { ops: ops0, previewToken: p0.previewToken, confirm: [] });
    const ids: string[] = [];
    for (const [i, v] of values.entries()) ids.push((await ok(d, "records.create", { type: "client", fields: { name: `Client ${i}`, taxid: v } })).record.id);
    // one value is edited, so the old text is in the change history too
    await ok(d, "records.update", { type: "client", recordId: ids[0], patch: { taxid: "TAX-OLD-EDITED" } });

    const ops = [{ op: "field.retype", type: "client", field: "taxid", toType: "sealed" }];
    const preview = await ok(d, "schema.diff", { ops });
    assert.deepEqual(preview.problems, []);
    assert.equal(preview.destructive, 1, "sealing needs a yes");
    assert.match(preview.items[0].summary, /cannot be turned back into plain text/);
    assert.equal(preview.items[0].affectedRows, 50);
    await ok(d, "schema.apply", { ops, previewToken: preview.previewToken, confirm: preview.items.map((i: { itemKey: string }) => i.itemKey) });
    await d.hooks?.pump?.();

    const rows = (await ok(d, "records.query", { type: "client" })).rows as { id: string; fields: Record<string, any> }[];   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(rows.length, 50);
    for (const r of rows) { assert.equal(r.fields.taxid.sealed, "taxid"); assert.match(r.fields.taxid.ref, /^vit_/); }
    const first = (await ok(d, "records.reveal", { type: "client", recordId: ids[0]!, field: "taxid" })).value;
    assert.equal(first, "TAX-OLD-EDITED");
    assert.equal((await ok(d, "records.reveal", { type: "client", recordId: ids[7]!, field: "taxid" })).value, values[7]);
  } finally { await d.stop(); }
  const leaks = [...values, "TAX-OLD-EDITED"].filter((v) => filesHolding(dir, v).length > 0).map((v) => `${v}: ${filesHolding(dir, v).join(", ")}`);
  assert.deepEqual(leaks.slice(0, 5), [], `no file holds a sealed value (${dir})`);
});

test("seal this field live: a crash halfway leaves the plaintext as it was, pressing Seal again carries on, and a crash before the cleaning ended is finished at the next boot", async () => {
  const { schemaVault, setSchemaVault } = await import("../modules/schema/handlers/seal.ts");
  const values = Array.from({ length: 50 }, (_, i) => `KILL-${String(2000 + i)}-PLAIN`);
  let { d, dir } = await bootSealed();
  const ids: string[] = [];
  try {
    const ops0 = [{ op: "type.create", type: "client", def: { title: "Client", plural: "Clients", icon: "table", label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "taxid", type: "text", title: "Tax ID" }] } }];
    const p0 = await ok(d, "schema.diff", { ops: ops0 });
    await ok(d, "schema.apply", { ops: ops0, previewToken: p0.previewToken, confirm: [] });
    for (const [i, v] of values.entries()) ids.push((await ok(d, "records.create", { type: "client", fields: { name: `Client ${i}`, taxid: v } })).record.id);

    const ops = [{ op: "field.retype", type: "client", field: "taxid", toType: "sealed" }];
    const seal = async (): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const preview = await ok(d, "schema.diff", { ops });
      return api(d, "schema.apply", { ops, previewToken: preview.previewToken, confirm: preview.items.map((i: { itemKey: string }) => i.itemKey) });
    };
    const real = schemaVault()!;
    assert.ok(real, "the host wired the Vault into the schema module");

    // 1. the Vault stops answering after 20 values: the apply fails and nothing changed
    let puts = 0;
    setSchemaVault({ ...real, put: async (o) => { if (++puts > 20) throw new Error("the Vault went away"); return real.put(o); } });
    const failed = await seal();
    assert.notEqual(failed.status, 200, "the apply fails when the Vault goes away");
    const after = (await ok(d, "records.query", { type: "client" })).rows as { fields: Record<string, unknown> }[];
    assert.deepEqual(after.map((r) => r.fields["taxid"]).sort(), [...values].sort(), "every value is still there, as text, and the field is still text");

    // 2. the Vault is back and the apply goes through (the 20 already made are reused), but the cleaning stops before it ends
    let scrubs = 0;
    setSchemaVault({ ...real, scrubField: async (t, f) => { if (++scrubs === 1) throw new Error("killed before the host copies were cleaned"); return real.scrubField!(t, f); } });
    const done = await seal();
    assert.equal(done.status, 200, JSON.stringify(done.data));
    await d.hooks?.pump?.();
    const left = (await ok(d, "records.query", { type: "client" })).rows as { fields: Record<string, any> }[];   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(left.every((r) => r.fields["taxid"].sealed === "taxid"), "every row holds a reference");
    const items = (await ok(d, "vault.items.list", { q: "client.taxid" })).items as unknown[];
    assert.equal(items.length, 50, "one Vault item per value: the 20 from the first try were reused");
  } finally { await d.stop(); }

  // 3. the next boot finishes what was owed
  setSchemaVault(null);
  ({ d } = await bootSealed(dir));
  try {
    const end = Date.now() + 20_000;
    while (values.some((v) => filesHolding(dir, v).length > 0) && Date.now() < end) { await d.hooks?.pump?.(); await new Promise((r) => setTimeout(r, 300)); }
    assert.equal((await ok(d, "records.reveal", { type: "client", recordId: ids[3]!, field: "taxid" })).value, values[3]);
  } finally { await d.stop(); }
  const leaks = values.filter((v) => filesHolding(dir, v).length > 0).map((v) => `${v}: ${filesHolding(dir, v).join(", ")}`);
  assert.deepEqual(leaks.slice(0, 5), [], `no file holds a value after the resume (${dir})`);
});
