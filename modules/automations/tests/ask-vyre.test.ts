// Server Ask Vyre scrubber: bearer tokens, key literals, and JWTs inside strings.
import test from "node:test";
import assert from "node:assert/strict";
import { askBundle, scrubDiagnostics } from "../ask-vyre.ts";

test("Ask Vyre redacts bearer tokens, key literals, and JWTs inside strings", () => {
  const bundle = askBundle({
    resource: "run",
    message: "Authorization: Bearer abcdefghijklmnop and eyJaaaaaaaa.bbbbbbbb.cccccccc and sk-abcdefghij",
    password: "should-not-leave",
  });
  assert.equal(bundle.message, "Authorization: Bearer [redacted] and [redacted] and [redacted]");
  assert.equal("password" in bundle, false);
  const walked = scrubDiagnostics({
    note: "Bearer abcdefghijklmnop eyJaaaaaaaa.bbbbbbbb.cccccccc sk-abcdefghij",
    cookie: "session=hidden",
  }) as { note?: string; cookie?: string };
  assert.equal(walked.note, "Bearer [redacted] [redacted] [redacted]");
  assert.equal(walked.cookie, undefined);
});
