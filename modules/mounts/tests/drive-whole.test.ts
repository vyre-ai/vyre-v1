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
