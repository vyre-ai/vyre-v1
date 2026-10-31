// The unblock task a turn with no AI account leaves has one title in two layers: the engine makes it, the app recognises it and offers the direct sign-in. They must stay equal.
import test from "node:test";
import assert from "node:assert/strict";
import { NO_ACCOUNT_TITLE as engine } from "../modules/engine/runtime.ts";
import { NO_ACCOUNT_TITLE as app } from "../apps/app/src/places/chats/needsyou/account.ts";

test("the engine and the app name the no-account task the same", () => {
  assert.equal(app, engine);
});
