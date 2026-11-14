// The words for a thing that is not there: which kind of thing and the name as the caller gave it, never an id, and no claim about things that exist: only what the kernel answered as not found.
import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeCode, notFoundLine, sayableName } from "./errors.ts";

test("it names the kind and the name the caller gave", () => {
  assert.equal(notFoundLine("connector", "fathom"), "There is no connector called fathom that you can see.");
  assert.equal(
    notFoundLine("Vault folder", "Shared keys"),
    "There is no Vault folder called Shared keys that you can see.",
  );
});

test("a snake_case name reads with spaces so a person never meets a code", () => {
  const line = notFoundLine("connector", "google_ads");
  assert.equal(line, "There is no connector called google ads that you can see.");
  assert.equal(looksLikeCode(line), false);
});

test("an id, a long or odd name, or nothing is never said back: only the kind", () => {
  for (const given of ["con_a1b2c3d4e5f6a7b8", "x".repeat(81), "<script>", "", undefined, 42, null])
    assert.equal(
      notFoundLine("connection", given),
      "There is no connection by that name that you can see.",
      String(given),
    );
  assert.equal(sayableName("con_a1b2c3d4e5f6a7b8"), null);
  assert.equal(sayableName("  fathom  "), "fathom");
});
