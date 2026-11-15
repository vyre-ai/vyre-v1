// A drop that crosses a connected folder's edge asks first: out says what leaves the provider, in says it will be uploaded, anything else does not ask.
import test from "node:test";
import assert from "node:assert/strict";
import { askMove, dropMoves } from "../tree/model.ts";
import type { Line } from "../tree/model.ts";

const line = (id: string, source: string | null, folderId: string | null): Line => ({
  key: `file:${id}`,
  type: "file",
  id,
  name: `${id}.docx`,
  kind: "document" as never,
  size: 1,
  updatedAt: 1,
  updatedBy: null,
  thumb: false,
  source,
  items: 0,
  folderId,
});

test("out of Google Drive asks with the sentence, in asks about the upload, a local move asks nothing", () => {
  const f = line("a", "google_drive", "fo_drive");
  const lineOf = (it: { id: string }) => (it.id === "a" ? f : line("b", null, "fo_local"));
  const items = [{ type: "file" as const, id: "a" }];
  const out = askMove(
    items,
    { id: "fo_local", source: null },
    lineOf,
    dropMoves(items, "fo_local", () => "fo_drive"),
  );
  assert.equal(out?.dir, "out");
  assert.equal(out?.sentence, "This will remove it from Google Drive for everyone it is shared with there.");
  assert.equal(out?.copies[0]?.cap, "files.copy");
  const into = askMove(
    [{ type: "file", id: "b" }],
    { id: "fo_drive", source: "google_drive" },
    lineOf,
    dropMoves([{ type: "file", id: "b" }], "fo_drive", () => "fo_local"),
  );
  assert.equal(into?.dir, "in");
  assert.match(into?.sentence ?? "", /uploaded to Google Drive/);
  assert.equal(
    askMove(
      [{ type: "file", id: "b" }],
      { id: "fo_x", source: null },
      lineOf,
      dropMoves([{ type: "file", id: "b" }], "fo_x", () => "fo_local"),
    ),
    null,
  );
});
