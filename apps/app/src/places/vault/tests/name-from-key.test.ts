// A paste that names no app (a plain key, a .env without a shared prefix) still gets a name from its first key, so Add is not left disabled for a reason the person cannot see.
import test from "node:test";
import assert from "node:assert/strict";
import { nameFromKey, understandPaste } from "../itemenv/env.ts";

test("a key is read as words for a name", () => {
  assert.equal(nameFromKey("MY_SERVICE_KEY"), "My service key");
  assert.equal(nameFromKey("API_KEY"), "API key");
  assert.equal(nameFromKey("DATABASE_URL"), "Database URL");
  assert.equal(nameFromKey(""), "");
});

test("the paste the owner tried names nothing, so the sheet names it from the key", () => {
  const u = understandPaste("MY_SERVICE_KEY=abc123secretvalue");
  assert.equal(u.name, undefined, "the paste itself names no app");
  assert.equal(nameFromKey(u.fields[0]!.key), "My service key");
});
