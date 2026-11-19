// A firm's Space set up through the API on a booted daemon (r40, 18 Nov 2026): a relation made with its type has both ends, bulk_upsert seals plain values, two fields seal in one call and keep
// their label, and the Vault items behind sealed values are not in the Vault list. (Its own file: the sealed-fields file is near the 30 s cap.)
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
const PEOPLE = ["usr_olivia", "usr_noah", "usr_tess"];

async function bootSealed(dir?: string): Promise<{ d: Daemon; dir: string }> {
  let where = dir;
  if (!where) {
    const core = bootCore();
    where = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sealed-"));
    core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    fs.copyFileSync(core.file, path.join(where, "events.db"));
    core.close();
  }
  const d = await startDaemon({
    config: loadConfig(["--data-dir", where, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux",
      hostname: "sealed-live",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${where}`]: { stdout: "/dev/mapper/vyre\n" },
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
  return { d, dir: where };
}

let keys = 0;
async function api(
  d: Daemon,
  cap: string,
  input: Record<string, unknown>,
  who = "usr_olivia",
): Promise<{ status: number; data: any }> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
    body: JSON.stringify({ idempotencyKey: `sf-${++keys}`, ...input }),
  });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>, who?: string): Promise<any> => {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(d, cap, input, who);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

/** Every file under the data directory that holds `needle` as bytes (a database, its WAL, a log). */
function filesHolding(dir: string, needle: string): string[] {
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

// ---------------------------------------------------------------- a firm's import through the API (r40)

test("a firm's setup live: a relation made with its type has both ends, bulk_upsert seals plain values, two fields seal in one call keeping their label, and the Vault list shows none of the backing items", async () => {
  const { d, dir } = await bootSealed();
  const DOB = "1971-03-09-ONLY";
  const SSN2 = "555-66-7777";
  try {
    const field = (key: string, type = "text", extra: Record<string, unknown> = {}) => ({
      key,
      type,
      title: key.toUpperCase(),
      ...extra,
    });
    const ops0 = [
      {
        op: "type.create",
        type: "party",
        def: {
          title: "Party",
          plural: "Parties",
          titleField: "name",
          fields: [
            field("name"),
            field("dob", "sealed", { label: "restricted" }),
            field("ssn", "text", { label: "restricted" }),
            field("tax", "text"),
          ],
        },
      },
      {
        op: "type.create",
        type: "matter",
        def: {
          title: "Matter",
          plural: "Matters",
          titleField: "name",
          fields: [field("name"), field("client", "relation", { options: { target: "party" } })],
        },
      },
    ];
    const p0 = await ok(d, "schema.diff", { ops: ops0 });
    assert.deepEqual(p0.problems, []);
    await ok(d, "schema.apply", { ops: ops0, previewToken: p0.previewToken, confirm: [] });
    const types = (await ok(d, "schema.types.list", {})).types as { key: string; fields?: { key: string }[] }[];
    const party = (await ok(d, "schema.types.get", { type: "party" })).type;
    assert.ok(types.length > 0);
    const far = party.fields.find((f: { type: string }) => f.type === "relation");
    assert.equal(far?.options.target, "matter", "party has the other end of matter.client");

    // bulk_upsert takes plain values for sealed fields, and nothing plain is kept
    const out = await ok(d, "records.bulk_upsert", {
      type: "party",
      match: ["name"],
      rows: [
        { name: "Ada", dob: DOB, ssn: SSN2 },
        { name: "Bo", dob: "1980-01-01-ONLY", ssn: "111-00-2222" },
      ],
    });
    assert.equal(out.created, 2, JSON.stringify(out));
    assert.equal(out.refused, undefined);
    const rows = (await ok(d, "records.query", { type: "party" })).rows as {
      id: string;
      fields: Record<string, any>;
    }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ada = rows.find((r) => r.fields.name === "Ada")!;
    assert.equal(ada.fields.dob.sealed, "dob");
    assert.equal((await ok(d, "records.reveal", { type: "party", recordId: ada.id, field: "dob" })).value, DOB);

    // two fields of one type seal in one call, and the label stays
    const ops = [
      { op: "field.retype", type: "party", field: "ssn", toType: "sealed" },
      { op: "field.retype", type: "party", field: "tax", toType: "sealed", def: { label: "restricted" } },
    ];
    const pv = await ok(d, "schema.diff", { ops });
    assert.deepEqual(pv.problems, []);
    await ok(d, "schema.apply", {
      ops,
      previewToken: pv.previewToken,
      confirm: pv.items.map((i: { itemKey: string }) => i.itemKey),
    });
    await d.hooks?.pump?.();
    const after = (await ok(d, "schema.types.get", { type: "party" })).type.fields as {
      key: string;
      type: string;
      label?: string;
    }[];
    for (const k of ["dob", "ssn", "tax"]) assert.equal(after.find((f) => f.key === k)?.type, "sealed", k);
    for (const k of ["dob", "ssn", "tax"]) assert.equal(after.find((f) => f.key === k)?.label, "restricted", k);
    assert.equal((await ok(d, "records.reveal", { type: "party", recordId: ada.id, field: "ssn" })).value, SSN2);

    // the Vault list shows none of the backing items, and neither does a search for them
    for (const q of [undefined, "party.dob", "party.ssn", "Sealed fields"]) {
      const list = (await ok(d, "vault.items.list", q ? { q } : {})).items as { name: string }[];
      assert.deepEqual(
        list.filter((i) => /^party\./.test(i.name)),
        [],
        `no backing item in the list for ${String(q)}`,
      );
    }
    const folders = (await ok(d, "vault.folders.list", {})).folders as { name: string }[];
    assert.ok(!folders.some((f) => f.name === "Sealed fields"), "the folder is not shown either");
  } finally {
    await d.stop();
  }
  for (const v of [DOB, SSN2]) assert.deepEqual(filesHolding(dir, v), [], `no file holds ${v}`);
});
