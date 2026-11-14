// A key kept for the server is checked as the caller first; a refusal says which of three things is true: the item is not there (or not theirs to see), it is Restricted, or it is not theirs to use.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CANNOT_USE, mustUse } from "./vault-check.ts";

const refusing = (code: string) => async () => {
  throw { error: { code } };
};
const said = async (code: string, handle = "#Fathom.api_key", o: { missingOk?: boolean } = {}): Promise<string> => {
  let line = "";
  await mustUse(
    refusing(code),
    handle,
    (m) => {
      line = m;
      throw new Error(m);
    },
    o,
  ).catch(() => undefined);
  return line;
};

test("an item that is not there, or that the caller may not see, says it is missing and names the item without its field", async () => {
  for (const code of ["permission.not_found", "validation.not_found"])
    assert.equal(
      await said(code),
      "There is no Vault item #Fathom that you can use. Check it is still in the Vault, or ask for the key.",
    );
});

test("a Restricted item says so and what fixes it", async () => {
  assert.match(await said("permission.above_clearance"), /^#Fathom is in a Restricted place.*Move it to your own keys/);
});

test("any other refusal keeps the old words, and a missing item still passes where it may (a sign-in app set up before its secret)", async () => {
  assert.equal(await said("permission.no_grant"), CANNOT_USE);
  assert.equal(await said("validation.not_found", "#Fathom", { missingOk: true }), "");
});
