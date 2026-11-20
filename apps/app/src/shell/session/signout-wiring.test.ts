// Sign Out always goes through the revoke queue, with or without an opened session: the common case (a session is open, the Space is unreachable or the page is closed right after) must leave the revoke queued for the
// next start, not drop it silently. (The queue itself is tested in revoke-token.test.ts.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("ShellHost's signOut revokes through revokeToken for every case, and never fires a bare session call that nothing retries", () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ShellHost.tsx"), "utf8");
  const body = src.slice(src.indexOf("const signOut = (): void => {"), src.indexOf("signOutRef.current = signOut;"));
  assert.ok(body.length > 0, "found signOut");
  assert.match(
    body,
    /void revokeToken\(\{[^}]*spaceId: stored\.def\.spaceId[^}]*\}\);/,
    "only the address, token and Space id are passed",
  );
  assert.doesNotMatch(body, /identity\.sign_out/, "no unqueued call");
  assert.doesNotMatch(body, /if \(session\)/, "no branch that skips the queue");
});
