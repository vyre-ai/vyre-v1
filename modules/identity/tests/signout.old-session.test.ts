// Signing out ends the session it is called from, however old that session is. The 30-day expires_at on identity_sessions is not checked where requests are let in (host/src/daemon/session.ts
// reads the devices tables), so a session older than that still works; signing out of it must still end it, here and at the gateway.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DEVICE, harness } from "./wire.ts";
import { SEED_PERSON } from "../fixtures/seed.ts";
import { provisionAccount } from "../projections.ts";

test("signing out of a session older than its 30 days ends it, at the gateway too", async () => {
  const h = harness();
  await provisionAccount(h.anon, SEED_PERSON);
  const a = await handlers["identity.sign_in"](h.anon, { username: "maya", password: SEED_PERSON.secret, ...DEVICE });
  const ctxA = h.as(SEED_PERSON.personId, { id: a.session!.sessionId, deviceId: a.session!.deviceId });
  h.advance(31 * 24 * 3_600_000);
  await handlers["identity.sign_out"](ctxA, {});
  const row = h.raw.rows("identity_sessions").find((r) => r["id"] === a.session!.sessionId)!;
  assert.notEqual(row["revoked_at"], null, "the session row is ended");
  assert.ok(h.ended.includes(a.session!.sessionId), "and the gateway is told to end it (the host's sessionTokens.end)");
});
