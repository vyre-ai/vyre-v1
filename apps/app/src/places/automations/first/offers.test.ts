import test from "node:test";
import assert from "node:assert/strict";
import { offersOf } from "./offers.ts";

test("the offers the server sends become rows with the app's name and the sentence; anything else is none", () => {
  assert.deepEqual(
    offersOf({ offers: [{ itemId: "vit_1", appName: "Notely", text: "Set up Notely for Automations?" }] }),
    [{ itemId: "vit_1", appName: "Notely", text: "Set up Notely for Automations?" }],
  );
  assert.deepEqual(
    offersOf({ offers: [{ itemId: "vit_2", appName: "Acme" }] })[0]!.text,
    "Set up Acme for Automations?",
  );
  assert.deepEqual(offersOf(null), []);
  assert.deepEqual(offersOf({ offers: [{ itemId: 3 }] }), []);
});
