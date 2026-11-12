// A Space stays signed in (owner rule): a session is not ended by its age. identity_sessions.expires_at (sign-in plus 30 days) is enforced nowhere, so every reader ignores it alike: a session
// older than that still works, is listed, and ends at once by sign-out or revoke. A booted daemon with a clock the test moves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";

const DAY = 24 * 3_600_000;

test("a session older than 30 days still works, is listed, and signing out or revoking it ends it at once", async () => {
  const dir = seededDir();
  let clock = Date.now();
  const d = await boot(dir, standIn, undefined, { now: () => clock });
  try {
    const ana = await join(d, "ana");
    const ben = await join(d, "ben");
    clock += 31 * DAY;
    assert.equal((await api(d, ana.token, "identity.whoami", {})).status, 200, "an old session still works");
    const listed = (await ok(d, ben.token, "devices.sessions.list", {})).sessions as Array<{ id: string; current?: boolean }>;
    assert.equal(listed.length, 1, "it is listed");
    await ok(d, ana.token, "identity.sign_out", {});
    assert.equal((await api(d, ana.token, "identity.whoami", {})).status, 401, "signing out of it ends it");
    await ok(d, ben.token, "devices.sessions.revoke", { sessionId: listed[0]!.id });
    assert.equal((await api(d, ben.token, "identity.whoami", {})).status, 401, "revoking it ends it");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
