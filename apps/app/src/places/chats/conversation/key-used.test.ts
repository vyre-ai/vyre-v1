// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { keyAlreadyUsed, withUploaded } from "./model.ts";

const conflict = (cap: string) => ({
  code: "validation.precondition_failed",
  details: { reason: "idempotency_conflict", cap },
});

test("only the post's own key says the message is already in the thread; a file's create refused for a new blob, or any other failure, keeps the Not sent bubble", () => {
  assert.equal(keyAlreadyUsed(conflict("chat.post")), true);
  assert.equal(
    keyAlreadyUsed(conflict("files.create")),
    false,
    "a large file uploaded again is a new blob under the same key: the post never ran",
  );
  assert.equal(keyAlreadyUsed(new TypeError("fetch failed")), false);
  assert.equal(
    keyAlreadyUsed({ code: "validation.precondition_failed", details: { reason: "other", cap: "chat.post" } }),
    false,
  );
  assert.equal(keyAlreadyUsed(null), false);
});

test("after an upload each file that had no stored file keeps the id it was given, in order, so Retry attaches it and uploads nothing again", () => {
  const files = [{ name: "a.pdf" }, { name: "kept.pdf", fileId: "fil_old" }, { name: "b.pdf" }];
  const after = withUploaded(files, ["fil_1", "fil_2"])!;
  assert.deepEqual(
    after.map((f) => f.fileId),
    ["fil_1", "fil_old", "fil_2"],
  );
  assert.deepEqual(
    after.filter((f) => f.fileId === undefined),
    [],
    "nothing is left to upload on a retry",
  );
  assert.equal(withUploaded(undefined, []), undefined);
});
