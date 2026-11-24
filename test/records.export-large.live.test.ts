// records.export makes its file on the server, so it is held to the 25 MB upload limit and not the 256 KB direct-write one (an export of Meier's 28,000 contacts is about 6 MB): 10,000 rows export as csv and as xlsx, and an export
// over 25 MB still fails, saying what the limit is and what to do. Real server-role daemon.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour } from "./support/member-hour.ts";
import type { Hour } from "./support/member-hour.ts";

let h: Hour;
before(async () => {
  h = await bootHour("exportlarge");
});
after(async () => {
  await h?.stop();
});

test("10,000 contacts export as csv and as xlsx", { timeout: 600_000 }, async () => {
  for (let b = 0; b < 20; b++)
    await h.owner.call("records.bulk_upsert", {
      type: "contact",
      match: ["email"],
      createOnly: true,
      idempotencyKey: `el-${b}`,
      rows: Array.from({ length: 500 }, (_, i) => ({
        name: `Export ${b}-${i}`,
        email: `e${b}-${i}@export.test`,
        phone: `+1 555 ${b}${String(i).padStart(4, "0")}`,
      })),
    });
  const csv = (await h.owner.call("records.export", { type: "contact", format: "csv" })) as { fileId: string };
  const got = (await h.owner.call("files.get", { fileId: csv.fileId })) as { file?: { size?: number; name?: string } };
  const size = got.file?.size ?? 0;
  assert.ok(size > 256 * 1024, `the csv is over the old 256 KB limit (${size} bytes)`);
  assert.ok(size > 10_000 * 20, `the csv holds the 10,000 rows (${size} bytes)`);
  const xlsx = (await h.owner.call("records.export", { type: "contact", format: "xlsx" })) as { fileId: string };
  const meta = (await h.owner.call("files.get", { fileId: xlsx.fileId })) as { file?: { size?: number } };
  assert.ok(xlsx.fileId, "the xlsx export made a file");
  assert.ok((meta.file?.size ?? 1) > 0);
});

test("an export over 25 MB fails and says what the limit is", { timeout: 900_000 }, async () => {
  // wide rows: a 20 KB note each, so a few thousand rows pass 25 MB
  const note = "x".repeat(20_000);
  for (let b = 0; b < 30; b++)
    await h.owner.call("records.bulk_upsert", {
      type: "contact",
      match: ["email"],
      createOnly: true,
      idempotencyKey: `el-wide-${b}`,
      rows: Array.from({ length: 50 }, (_, i) => ({ name: `Wide ${b}-${i} ${note}`, email: `w${b}-${i}@wide.test` })),
    });
  const asked = await h.owner.attempt("records.export", {
    type: "contact",
    format: "csv",
    fields: ["name", "email"],
    filter: { field: "email", op: "contains", value: "@wide.test" },
  });
  assert.equal(asked.ok, false, "a 30 MB export is refused");
  const err = asked.error as { code?: string; message?: string };
  assert.equal(err.code, "validation.too_large");
  assert.match(String(err.message), /25 MB/, `the refusal says what the limit is: ${err.message}`);
  assert.match(String(err.message), /fewer rows or fewer columns/, "an export is told what a person can do");
});
