import test from "node:test";
import assert from "node:assert/strict";
import { NO_MISSING_QUERY } from "./useMissing.ts";

test("the missing-item fallback keeps one loading snapshot while no item is selected", () => {
  assert.equal(NO_MISSING_QUERY.getSnapshot(), NO_MISSING_QUERY.getSnapshot());
});
