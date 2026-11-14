import test from "node:test";
import assert from "node:assert/strict";
import { claimResumeFoot, resumeInFoot } from "./resume-place.ts";

test("while the sidebar is on screen the entry is in its foot, and it goes back to the title bar when the sidebar goes", () => {
  assert.equal(resumeInFoot(), false);
  const a = claimResumeFoot();
  const b = claimResumeFoot();
  assert.equal(resumeInFoot(), true);
  a();
  assert.equal(resumeInFoot(), true, "another sidebar still holds it");
  b();
  assert.equal(resumeInFoot(), false);
});
