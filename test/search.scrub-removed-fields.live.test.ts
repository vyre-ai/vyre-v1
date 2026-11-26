// The one-time scrub of search entries that carry text of removed fields, on a real server-role daemon with a Meier-sized type (9,500 records). The state a Space was left in by the build before is made by hand: the field is
// dropped, then every document gets the dropped text put back in the index (the way old entries sat there), and the job's row is removed as it is on the first start of the new build. Then the job runs: the old text is
// not found at any point while it runs (the index table is read every 40 ms, and search is asked the whole time), every record is still found by another field afterwards, the longest stretch the loop was held is
// under 100 ms, the doctor's count goes from N to 0, and a second start does nothing.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, waitFor } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";
import { searchRemovedTextFinding } from "../host/src/daemon/doctor.ts";

const N = 9_500;
const type = "matter9500";
let h: Hour;
before(async () => {
  h = await bootHour("scrubremoved");
});
after(async () => {
  await h?.stop();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** The longest time the loop went without running a 2 ms timer. */
function watchLoop(): { stop(): Promise<number> } {
  let last = performance.now(),
    max = 0;
  const t = setInterval(() => {
    const at = performance.now();
    max = Math.max(max, at - last - 2);
    last = at;
  }, 2);
  return {
    stop: async () => {
      await sleep(10);
      clearInterval(t);
      return Math.round(max);
    },
  };
}
const db = () => h.d.db!;
const one = (sql: string, ...a: unknown[]): number => Number((db().all(sql, ...a)[0] as { c: number }).c);
const row = (): { state: string; before: number; after: number; scanned: number; total: number } =>
  JSON.parse(String((db().all("SELECT v FROM search_meta WHERE k = 'scrub:removed_fields'")[0] as { v: string }).v));

test("the one-time scrub takes the removed field's text out of 9,500 entries without ever showing it, loses no record, never holds the loop for 100 ms, and runs once", async () => {
  await h.owner.call("schema.apply", {
    idempotencyKey: "srf-type",
    ops: [
      {
        op: "type.create",
        type,
        def: {
          title: "Matter",
          plural: "Matters",
          icon: "table",
          titleField: "name",
          fields: ["name", "note"].map((key) => ({ key, type: "text", title: key })),
        },
      },
    ],
  });
  for (let at = 0; at < N; at += 500)
    await h.owner.call("records.bulk_upsert", {
      idempotencyKey: `srf-rows-${at}`,
      type,
      match: ["name"],
      createOnly: true,
      runAutomations: false,
      rows: Array.from({ length: 500 }, (_, i) => ({ name: `Matter ${at + i}`, note: `zqnote${at + i} tagged` })),
    });
  await waitFor(
    async () => {
      await h.d.hooks?.pump?.();
      return one("SELECT count(*) AS c FROM search_docs WHERE record_type = ?", type) >= N ? true : null;
    },
    240_000,
    "the index holds every record",
  );
  const diff = (await h.owner.call("schema.diff", { ops: [{ op: "field.drop", type, field: "note" }] })) as {
    previewToken: string;
    items: Array<{ itemKey: string; destructive: boolean }>;
  };
  await h.owner.call("schema.apply", {
    idempotencyKey: "srf-drop",
    ops: [{ op: "field.drop", type, field: "note" }],
    previewToken: diff.previewToken,
    confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey),
  });
  // the index follows the drop itself now (modules/search, search.titles): wait for it to finish, then put the old text back the way the build before left it
  await waitFor(
    async () => {
      await h.d.hooks?.pump?.();
      return one("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqnote%'") === 0 &&
        one("SELECT count(*) AS c FROM search_meta WHERE k LIKE 'reindex:%'") === 0
        ? true
        : null;
    },
    240_000,
    "the index has followed the drop",
  );
  const docs = db().all(
    "SELECT n, title, body, kind, record_type AS rtype, folder_id AS folder FROM search_docs WHERE record_type = ? ORDER BY n",
    type,
  ) as Array<{ n: number; title: string; body: string; kind: string; rtype: string; folder: string | null }>;
  assert.equal(docs.length, N);
  for (let i = 0; i < docs.length; i += 200) {
    for (const d of docs.slice(i, i + 200)) {
      const body = `${d.body} zqold${d.n} tagged`;
      db().run("UPDATE search_docs SET body = ? WHERE n = ?", body, d.n);
      db().run("DELETE FROM search_fts WHERE rowid = ?", d.n);
      db().run(
        "INSERT INTO search_fts (rowid, title, body, kind, rtype, folder) VALUES (?, ?, ?, ?, ?, ?)",
        d.n,
        d.title,
        body,
        d.kind,
        d.rtype,
        d.folder ?? "",
      );
    }
    await sleep(0);
  }
  db().run("DELETE FROM search_meta WHERE k = 'scrub:removed_fields'");
  const sample = docs[4_321]!;
  const hit = async (): Promise<unknown[]> =>
    ((await h.owner.call("search.query", { q: `zqold${sample.n}`, limit: 5 })) as { hits: unknown[] }).hits;
  assert.equal((await hit()).length, 1, "control: the old text is found in the index the build before left");
  const lead = searchRemovedTextFinding(h.d.paths.modules);
  assert.match(lead.detail, /not counted yet/, `before the job: ${lead.detail}`);

  // the job runs; the loop is watched, the index table is read every 40 ms for an entry that shows the old text, and search is asked as a person would
  const watch = watchLoop();
  let shown = 0,
    reads = 0,
    asked = 0,
    askedHits = 0,
    running = true,
    readMax = 0;
  const readerLoop = async (): Promise<void> => {
    while (running) {
      reads++;
      const q0 = performance.now();
      shown += one(
        `SELECT count(*) AS c FROM search_docs d WHERE d.n IN (SELECT rowid FROM search_fts WHERE search_fts MATCH 'zqold*') AND NOT EXISTS (SELECT 1 FROM search_meta m WHERE m.k = 'scrubhide:' || d.record_type)`,
      );
      readMax = Math.max(readMax, performance.now() - q0);
      await sleep(40);
    }
  };
  const askerLoop = async (): Promise<void> => {
    while (running) {
      asked++;
      askedHits += (await hit()).length;
      await sleep(700);
    }
  };
  const t0 = performance.now();
  const job = h.d.searchScrub();
  // the first slice holds the type back in one transaction: from then on the old text is never shown (the entries were findable until the job began, as before this build)
  await waitFor(
    async () => (db().all("SELECT 1 FROM search_meta WHERE k = 'scrub:removed_fields'").length ? true : null),
    20_000,
    "the job began",
  );
  const reader = readerLoop();
  const asker = askerLoop();
  await job;
  const took = Math.round(performance.now() - t0);
  running = false;
  await Promise.all([reader, asker]);
  const longest = await watch.stop();
  console.log(
    `scrub of ${N} entries: ${took} ms, longest loop block ${longest} ms (the 40 ms index read itself took up to ${Math.round(readMax)} ms), index read ${reads} times, search asked ${asked} times, shown ${shown}, ${JSON.stringify(row())}`,
  );
  assert.equal(shown, 0, "no entry showed the old text at any read of the index while the job ran");
  assert.equal(askedHits, 0, "search never found the old text while the job ran");
  assert.ok(reads > 5 && asked > 2, "the checks ran during the job");
  assert.ok(longest < 100, `the longest stretch the loop was held during the job was ${longest} ms (limit 100)`);
  const s = row();
  assert.deepEqual([s.state, s.before, s.after, s.total], ["done", N, 0, N], "the count before is N and after is 0");
  assert.equal(one("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqold%'"), 0);
  assert.equal(one("SELECT count(*) AS c FROM search_meta WHERE k LIKE 'scrubhide:%' OR k LIKE 'scrubpos:%'"), 0);
  assert.equal((await hit()).length, 0, "the old text is not found afterwards");
  const done = searchRemovedTextFinding(h.d.paths.modules);
  assert.equal(done.state, "healthy");
  assert.match(done.detail, new RegExp(`removed-field text: 0 \\(the one-time check found ${N}`));

  // every record is still found by its name: all of them by the full text index, and a spread of them through search itself
  assert.equal(
    one(
      "SELECT count(*) AS c FROM search_docs d WHERE d.record_type = ? AND d.n IN (SELECT rowid FROM search_fts WHERE search_fts MATCH '\"Matter\"*')",
      type,
    ),
    N,
    "every record is found by its name in the full text index",
  );
  // four-digit names match only themselves as a prefix
  for (let k = 0; k < 20; k++) {
    const name = `Matter ${1_000 + k * 400}`;
    let out: { hits: Array<{ title: string }> } | undefined;
    for (let t = 0; t < 40 && !out; t++)
      try {
        out = (await h.owner.call("search.query", { q: name, recordType: type, limit: 50 })) as typeof out;
      } catch {
        await sleep(1_000); // search is rate limited
      }
    assert.ok(
      out!.hits.some((x) => x.title === name),
      `${name} is found by search after the job`,
    );
  }

  // a second start: a finished job reads nothing and writes nothing
  const rowBefore = JSON.stringify(row());
  await h.d.searchScrub();
  assert.equal(JSON.stringify(row()), rowBefore, "the second start leaves the job's row as it was");
  assert.equal(one("SELECT count(*) AS c FROM search_meta WHERE k LIKE 'scrubhide:%'"), 0);
});
