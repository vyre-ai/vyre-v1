// What a file over a size limit says: the limit for everyone, and the advice about rows and columns only when the file is an export of records (a person's own big photo is not told to use fewer columns).
import { test } from "node:test";
import assert from "node:assert/strict";
import { overUploadWords, tooLargeWords } from "../modules/files/handlers/tree.ts";

test("a file over the upload limit says the limit; only an export is told about rows and columns", () => {
  const photo = overUploadWords({});
  assert.match(photo, /25 MB/);
  assert.doesNotMatch(photo, /rows|columns/);
  assert.equal(overUploadWords({ callerCap: "documents.fill" }), photo);
  const exported = overUploadWords({ callerCap: "records.export" });
  assert.match(exported, /25 MB/);
  assert.match(exported, /fewer rows or fewer columns/);
  assert.equal(tooLargeWords({ callerCap: "records.export" }), exported);
  assert.equal(tooLargeWords({ callerCap: "documents.fill" }), photo);
  assert.match(tooLargeWords({}), /256 KB/);
});
