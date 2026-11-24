// connectors.export on a connector of a firm's size, in a big Space (20 Nov 2026: crm_lawmatics, 25 tables, 50+ actions, timed out at 60 s on the firm's server and left the caller waiting).
// The export writes one Files record for each action and each recorded test; on a Space of thousands of records each write used to wait behind the others and the access rebuild they start.
// It must answer inside a bound that does not grow with the size of the Space, and must leave one whole folder (or none), never a half one.
import test from "node:test";
import fs from "node:fs";
import inspector from "node:inspector";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { call, hostLog } from "./support/eco-live.ts";
import { spec, world } from "./support/sync-live.ts";
import { seed } from "./support/bigspace-kit.ts";

const TABLES = Number(process.env["EXPORT_TABLES"] ?? 25);
// half the firm's size by default (14,000 contacts, 4,700 matters of 100 fields, 550 organizations: about 19,000 records, the same Space shape): the seed was 68 s of a 93 s file. EXPORT_SCALE=1 is the full size.
const SCALE = Number(process.env["EXPORT_SCALE"] ?? 0.5);
const BOUND_MS = 15_000;

/** The stand-in app's matters list under many names: each one is a table of the connector, with its own list actions and its own recorded test. */
const wide = () => {
  const s = spec();
  const base = s.objects.find((o) => o.remote === "matters")!;
  const map = s.mapping.find((m) => m.remote === "matters")!;
  s.objects = [base];
  s.mapping = [map];
  for (let i = 1; i < TABLES; i++) {
    s.objects.push({ ...structuredClone(base), remote: `matters_${i}`, label: `Matter ${i}` });
    s.mapping.push({ ...structuredClone(map), remote: `matters_${i}`, recordType: `matter_${i}` });
  }
  return s;
};

test(
  "connectors.export of a 25-table connector in a big Space answers inside its bound and leaves one whole folder",
  { timeout: 900_000 },
  async () => {
    const w = await world(true);
    try {
      assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
      const t0 = Date.now();
      await seed(
        w.d,
        {
          matters: Math.round(9400 * SCALE),
          fields: 100,
          contacts: Math.round(28000 * SCALE),
          orgs: Math.round(1100 * SCALE),
        },
        (m) => process.stderr.write(`[export] ${m}\n`),
      );
      process.stderr.write(`[export] seeded in ${Date.now() - t0} ms\n`);
      const applied = await call(w.d, "sync_specs.apply", { spec: wide(), idempotencyKey: "export-wide" });
      assert.equal(applied.status, 200, JSON.stringify(applied.data).slice(0, 400));
      const key = String(applied.data.connector);
      const got = await call(w.d, "connectors.get", { key });
      const actions = (got.data.connector ?? got.data).actions?.length;
      process.stderr.write(`[export] connector ${key}: ${actions} actions\n`);
      const t1 = Date.now();
      const cpu0 = process.cpuUsage();
      // EXPORT_PROFILE=<file>: a CPU profile of the export alone (the seed would drown it otherwise)
      const session = process.env["EXPORT_PROFILE"] ? new inspector.Session() : undefined;
      if (session) {
        session.connect();
        await new Promise((ok) => session.post("Profiler.enable", () => session.post("Profiler.start", ok)));
      }
      const out = await call(w.d, "connectors.export", { key });
      if (session)
        await new Promise<void>((ok) =>
          session.post("Profiler.stop", (_e, r) => {
            fs.writeFileSync(process.env["EXPORT_PROFILE"]!, JSON.stringify(r.profile));
            ok();
          }),
        );
      const ms = Date.now() - t1;
      const cpu = process.cpuUsage(cpu0);
      process.stderr.write(
        `[export] CPU of the process during the export: ${Math.round((cpu.user + cpu.system) / 1000)} ms\n`,
      );
      process.stderr.write(`[export] export answered ${out.status} in ${ms} ms\n`);
      assert.equal(out.status, 200, JSON.stringify(out.data).slice(0, 400) + "\n" + hostLog(w.d));
      assert.ok(ms < BOUND_MS, `the export took ${ms} ms (bound ${BOUND_MS})`);
      const folderId = out.data.folderId as string;
      const listed = await call(w.d, "files.list", { folder: folderId, limit: 500 });
      const sub = await Promise.all(
        ((listed.data.folders ?? []) as { folderId: string }[]).map((f) =>
          call(w.d, "files.list", { folder: f.folderId, limit: 500 }),
        ),
      );
      const count = (listed.data.files ?? []).length + sub.reduce((n, r) => n + (r.data.files ?? []).length, 0);
      assert.ok(count >= (actions ?? 0) + 2, `the folder holds ${count} files for ${actions} actions`);
      // all or none: a batch with one taken name makes nothing, on the real server
      const rows = (table: string): number => {
        const db = new DatabaseSync(w.d.paths.modules, { readOnly: true });
        try {
          return Number((db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c);
        } finally {
          db.close();
        }
      };
      const before = (await call(w.d, "files.list", { folder: folderId, limit: 500 })).data.files.length;
      const blobsBefore = rows("files_blob");
      const versionsBefore = rows("files_file_version");
      const refused = await call(w.d, "files.create_many", {
        folderId,
        files: [
          { name: "fresh.txt", content: { text: "x" } },
          { name: "connector.toml", content: { text: "dup" } },
        ],
        idempotencyKey: "export-dup",
      });
      assert.equal(refused.status, 422, JSON.stringify(refused.data).slice(0, 200));
      const afterwards = (await call(w.d, "files.list", { folder: folderId, limit: 500 })).data.files;
      assert.equal(afterwards.length, before, "the refused batch made no file");
      assert.ok(!afterwards.some((f: { name: string }) => f.name === "fresh.txt"));
      // the stored content of the refused batch went with it: no blob, no version row is left behind
      assert.equal(rows("files_blob"), blobsBefore, "a refused batch leaves no blob");
      assert.equal(rows("files_file WHERE name = 'fresh.txt'"), 0, "a refused batch leaves no file row");
      assert.equal(rows("files_file_version"), versionsBefore, "a refused batch leaves no version");
    } finally {
      await w.close();
    }
  },
);
