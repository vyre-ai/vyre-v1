// @reads /modules/mounts/handlers/engine.ts
// @reads /modules/mounts/fixtures/world.ts
// F20 (13 Nov 2026): the owner's Drive stopped listing at the first name Vyre refused or the first duplicate in a folder, so a Drive with several pages of files showed a few dozen and went red. A folder
// of more than one page lists WHOLE: every file on every page, odd names and doubles included, and the Drive stays healthy.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
const call = (w: ReturnType<typeof harness>, cap: keyof typeof handlers, input: Row): Promise<Row> =>
  (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);

const T = "2026-10-01T10:00:00.000Z";
const item = (id: string, name: string): Row => ({ id, name, mimeType: "application/pdf", modifiedTime: T, size: 10 });

test("a Drive folder of three pages with odd names and doubles on every page lists every file", async () => {
  const w = harness();
  const PAGES = 3;
  const PER = 100;
  const pages: Row[] = [];
  for (let p = 0; p < PAGES; p++) {
    const files: Row[] = [];
    for (let i = 0; i < PER; i++) {
      const n = p * PER + i;
      // every tenth file has a slash in its name, every seventh repeats the name of one on the page before
      const name = n % 10 === 5 ? `Q3/Q4 plan ${n}.pdf` : n % 7 === 3 ? `Budget.pdf` : `file ${n}.pdf`;
      files.push(item(`i${n}`, name));
    }
    pages.push({ files, ...(p < PAGES - 1 ? { nextPageToken: `page${p + 2}` } : {}) });
  }
  w.google.listings.set("root_drv", pages);
  const added = await call(w, "mounts.add", {
    into: "fld_into",
    source: { kind: "google_drive", connectionId: "con_g", ref: "root_drv" },
    name: "Drive",
  });
  const mount = (await call(w, "mounts.get", { mountId: String(added["mountId"]) }))["mount"] as Row;
  assert.equal(mount["state"], "idle", String(mount["error"]));
  assert.equal(w.files.paths().length, PAGES * PER, `listed ${w.files.paths().length} of ${PAGES * PER}`);
  assert.equal(mount["skippedCount"], undefined, "nothing was skipped");
});

test("a listing that never stops giving a next page is read over several passes: nothing already in Files is removed meanwhile, the mount says how far it got in plain words, and the words go when it is whole", async () => {
  const w = harness();
  w.google.listings.set("root_drv", [{ files: [item("keep", "keep.pdf")] }]);
  const added = await call(w, "mounts.add", {
    into: "fld_into",
    source: { kind: "google_drive", connectionId: "con_g", ref: "root_drv" },
    name: "Drive",
  });
  const mountId = String(added["mountId"]);
  const view = async (): Promise<Row> => (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.deepEqual(w.files.paths(), ["Drive/keep.pdf"]);
  // the provider now answers an endless run of pages, and keep.pdf is not on any of them
  const real = w.google.call.bind(w.google);
  let endless = true;
  w.google.call = (cap: string, i: Row): unknown => {
    if (endless && cap === "google.drive.list_files") {
      const n = i["pageToken"] === undefined ? 0 : Number(String(i["pageToken"]).replace("page", ""));
      return { files: [item(`p${n}`, `page ${n}.pdf`)], nextPageToken: `page${n + 1}` };
    }
    return real(cap, i);
  };
  await call(w, "mounts.sync_now", { mountId });
  const v = await view();
  assert.equal(v["state"], "idle", "a partial listing is not a failing Drive");
  assert.match(
    String(v["error"]),
    /Reading this folder: [\d,]+ items so far\. It carries on at the next sync, and nothing is removed/,
  );
  assert.ok(w.files.paths().includes("Drive/keep.pdf"), "nothing is removed on a partial listing");
  assert.ok(w.files.paths().length > 100, "what was read came in");
  const first = Number(v["scanned"]);
  assert.ok(first >= 200, "the mount says how many it has read");
  await call(w, "mounts.sync_now", { mountId });
  assert.ok(Number((await view())["scanned"]) > first, "the next pass carries on from there");
  assert.ok(w.files.paths().includes("Drive/keep.pdf"), "still nothing removed while the listing is unfinished");
  // the listing ends: the words go, and only now is what no pass saw treated as gone
  endless = false;
  await call(w, "mounts.sync_now", { mountId });
  const done = await view();
  assert.equal(done["error"], undefined);
  assert.equal(done["scanned"], undefined);
  assert.ok(
    !w.files.paths().includes("Drive/keep.pdf"),
    "keep.pdf was on no page of the whole listing, so it is gone now",
  );
});

// Part 3 (15 Nov 2026): a folder larger than one pass reads finishes over several passes. The position (the folders still to open, the page token, the ids seen, the change token taken at the start) is kept with
// the mount, so a pass that fails or a restart resumes there instead of from the first page, the mount says how far it got, and only the pass that reads the last page may treat a missing file as gone.
test("a Drive folder of 1,000 pages finishes over several passes: it resumes where it stopped, says how far it got, and removes a missing file only at the end", async () => {
  const w = harness();
  const PAGES = 1000;
  w.google.listings.set("root_drv", [{ files: [item("old", "old.pdf")] }]);
  const added = await call(w, "mounts.add", {
    into: "fld_into",
    source: { kind: "google_drive", connectionId: "con_g", ref: "root_drv" },
    name: "Drive",
  });
  const mountId = String(added["mountId"]);
  const view = async (): Promise<Row> => (await call(w, "mounts.get", { mountId }))["mount"] as Row;
  assert.deepEqual(w.files.paths(), ["Drive/old.pdf"]);
  // Drive now lists 1,000 pages of one file each, and old.pdf is on none of them
  const real = w.google.call.bind(w.google);
  const asked: string[] = [];
  w.google.call = (cap: string, i: Row): unknown => {
    if (w.google.failWith) throw w.google.failWith;
    if (cap === "google.drive.list_files" && i["parentId"] === "root_drv") {
      const n = i["pageToken"] === undefined ? 1 : Number(String(i["pageToken"]).replace("page", ""));
      asked.push(String(n));
      return { files: [item(`p${n}`, `page ${n}.pdf`)], ...(n < PAGES ? { nextPageToken: `page${n + 1}` } : {}) };
    }
    return real(cap, i);
  };
  await call(w, "mounts.sync_now", { mountId });
  let v = await view();
  assert.equal(v["state"], "idle");
  assert.equal(v["scanned"], 200);
  assert.match(String(v["error"]), /Reading this folder: 200 items so far\./);
  assert.ok(w.files.paths().includes("Drive/old.pdf"), "nothing is removed while the listing is unfinished");

  // a pass that fails in the middle resumes from the page it stopped at, not from page 1
  const before = asked.length;
  w.google.failWith = (await import("../fixtures/world.ts")).vyreErr("provider.unavailable", "Drive is down.", true);
  await call(w, "mounts.sync_now", { mountId });
  w.google.failWith = null;
  assert.equal((await view())["state"], "failing");
  assert.equal(asked.length, before, "the failed pass read nothing");
  await call(w, "mounts.sync_now", { mountId });
  assert.equal(asked[before], "201", "the next pass starts at page 201");
  assert.equal((await view())["scanned"], 400);
  for (let i = 0; i < 3; i++) await call(w, "mounts.sync_now", { mountId });
  v = await view();
  assert.equal(v["scanned"], undefined, "the listing is whole");
  assert.equal(v["error"], undefined);
  assert.equal(asked.length, PAGES, "every page was read exactly once");
  assert.equal(w.files.paths().length, PAGES, "1,000 files came in and old.pdf, on no page, is gone");
  assert.ok(!w.files.paths().includes("Drive/old.pdf"));
  assert.equal((w.db.rows("mounts_scan_seen") as Row[]).length, 0, "the seen list is cleared");
});
