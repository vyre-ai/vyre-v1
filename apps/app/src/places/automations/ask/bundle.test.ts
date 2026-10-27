// Ask Vyre UI scrubber: allowlist stays, and secret shapes inside kept strings are redacted.
import test from "node:test";
import assert from "node:assert/strict";
import { scrubAskContext } from "./bundle.ts";

test("a bearer token inside message is redacted and a short message stays", () => {
  const bundle = scrubAskContext({ message: "Authorization: Bearer abcdefghijklmnop" });
  assert.equal(bundle.message, "Authorization: Bearer [redacted]");
  assert.equal(bundle.message.includes("abcdefghijklmnop"), false);
  const ordinary = scrubAskContext({ message: "The step failed" });
  assert.equal(ordinary.message, "The step failed");
});

test("a JWT inside message is redacted", () => {
  const bundle = scrubAskContext({ message: "saw eyJaaaaaaaa.bbbbbbbb.cccccccc in the error" });
  assert.equal(bundle.message, "saw [redacted] in the error");
});

test("an sk- key inside message is redacted", () => {
  const bundle = scrubAskContext({ message: "key sk-abcdefghij leaked" });
  assert.equal(bundle.message, "key [redacted] leaked");
});

test("a field named password is not copied", () => {
  const bundle = scrubAskContext({
    message: "The step failed",
    password: "should-not-leave",
    fields: [
      { name: "password", type: "string" },
      { name: "to", type: "string" },
    ],
  });
  assert.deepEqual(bundle.fields, [{ name: "to", type: "string" }]);
  assert.equal("password" in bundle, false);
  assert.equal(JSON.stringify(bundle).includes("should-not-leave"), false);
});

test("an unknown field such as cookie is not copied", () => {
  const bundle = scrubAskContext({
    message: "The step failed",
    cookie: "session=hidden",
    note: "also-unknown",
  });
  assert.equal(bundle.message, "The step failed");
  assert.equal("cookie" in bundle, false);
  assert.equal("note" in bundle, false);
  assert.equal(JSON.stringify(bundle).includes("session=hidden"), false);
  assert.equal(JSON.stringify(bundle).includes("also-unknown"), false);
});

test("kept strings are scrubbed, including errorCode, traceId, connectionId, and field names and types", () => {
  const bundle = scrubAskContext({
    errorCode: "Bearer abcdefghijklmnop",
    traceId: "eyJaaaaaaaa.bbbbbbbb.cccccccc",
    connectionId: "sk-abcdefghij",
    fields: [{ name: "sk-abcdefghij", type: "eyJaaaaaaaa.bbbbbbbb.cccccccc" }],
  });
  assert.equal(bundle.errorCode, "Bearer [redacted]");
  assert.equal(bundle.traceId, "[redacted]");
  assert.equal(bundle.connectionId, "[redacted]");
  assert.deepEqual(bundle.fields, [{ name: "[redacted]", type: "[redacted]" }]);
});
