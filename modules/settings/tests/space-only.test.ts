// A setting that belongs to the whole Space cannot be written at person scope, so a person's own row can never stand in for the Space's: mail.send reads mail.provider, and only the Space's row answers.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";

test("a person cannot write or reset a Space-only setting (mail.provider) at person scope, and what mail.send reads stays the Space's value", async () => {
  const h = harness();
  const asMaya = h.as("usr_maya");
  const before = await handlers["settings.get"](asMaya, { key: "mail.provider" });
  for (const run of [
    () => handlers["settings.set"](asMaya, { key: "mail.provider", value: "smtp" }),
    () => handlers["settings.reset"](asMaya, { key: "mail.provider" }),
  ])
    assert.equal(await run().then(() => "", codeOf), "validation.bad_input");
  const after = await handlers["settings.get"](asMaya, { key: "mail.provider" });
  assert.deepEqual(
    [after.row.value, after.row.source],
    [before.row.value, before.row.source],
    "the value and where it comes from are unchanged",
  );
  assert.equal(after.row.scope, "space");
});
