import test from "node:test";
import assert from "node:assert/strict";
import { ClaimError, claimOwner } from "./claim.ts";
import type { ClaimDeps } from "./claim.ts";
import { CapError } from "../shell/session/caps.ts";
import { FAILURE_LINE, claimToken, failureOf, fingerprintOf, spaceIdOf, spaceNameOf, isDeadLink, problemOf } from "./logic.ts";

const bundle = { personKeyByPassword: "pw", personKeyByRecovery: "rc", publicKey: "pk", privateKeyWrapped: "sk" };

function deps(over: Partial<ClaimDeps> = {}): { d: ClaimDeps; calls: { cap: string; input: Record<string, unknown> }[]; held: Uint8Array[]; wiped: Uint8Array[]; seen: string[] } {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const held: Uint8Array[] = [];
  const wiped: Uint8Array[] = [];
  const seen: string[] = [];
  const d: ClaimDeps = {
    call: async (cap, input) => { calls.push({ cap, input: input as Record<string, unknown> }); return { status: "ok", session: { token: "vst_owner" }, principal: { id: "usr_owner" } }; },
    makeBundle: async (_pw, _rc, spaceId) => { seen.push(spaceId); return { ...bundle, personKey: new Uint8Array(32).fill(9) }; },
    holdKey: async (_t, key) => { held.push(new Uint8Array(key)); return true; },
    wipe: (b) => { wiped.push(b); b.fill(0); },
    ...over,
  };
  return { d, calls, held, wiped, seen };
}
const input = { token: "tok_abcdefgh", spaceId: "spc_core", name: " Irfad Imtiaz ", username: "irfad", password: "correct horse", recoveryCode: "ABCD-EFGH-JKMN-PQRS", deviceName: "Web browser" };

test("claim: the bundle is made on this device and only its wrapped halves are sent", async () => {
  const { d, calls, seen } = deps();
  const out = await claimOwner(d, input);
  assert.deepEqual(seen, ["spc_core"], "the Space key is made for the Space id from the link");
  assert.deepEqual(out, { token: "vst_owner", personId: "usr_owner" });
  assert.equal(calls[0]!.cap, "identity.claim_owner");
  const sent = calls[0]!.input;
  assert.equal(sent["code"], "tok_abcdefgh");
  assert.equal(sent["spaceId"], "spc_core");
  assert.ok(!("token" in sent), "the field is code");
  assert.equal(sent["displayName"], "Irfad Imtiaz");
  assert.deepEqual(sent["keys"], { ...bundle, spaceKeys: [] });
  assert.ok(!("personKey" in (sent["keys"] as object)), "the unwrapped person key is never in the call");
});

test("claim: the person key goes to the local daemon after the claim, and is wiped either way", async () => {
  const ok = deps();
  await claimOwner(ok.d, input);
  assert.equal(ok.held.length, 1);
  assert.equal(ok.held[0]!.length, 32);
  assert.equal(ok.wiped.length >= 1, true);
  const refused = deps({ call: async () => { throw new CapError({ code: "auth.claim_used", message: "used", traceId: "t", status: 409 }); } });
  await assert.rejects(claimOwner(refused.d, input), (e: unknown) => e instanceof ClaimError && e.failure === "used");
  assert.equal(refused.held.length, 0, "a refused claim never hands a key anywhere");
  assert.equal(refused.wiped.length >= 1, true);
});

test("claim: a daemon that refuses the key does not undo the claim", async () => {
  const { d } = deps({ holdKey: async () => { throw new Error("not loopback"); } });
  assert.equal((await claimOwner(d, input)).token, "vst_owner");
});

test("claim: no network is unreachable; no session in the answer is an error", async () => {
  await assert.rejects(claimOwner(deps({ call: async () => { throw new TypeError("fetch failed"); } }).d, input), (e: unknown) => e instanceof ClaimError && e.failure === "unreachable");
  await assert.rejects(claimOwner(deps({ call: async () => ({ status: "ok" }) }).d, input), (e: unknown) => e instanceof ClaimError && e.failure === "other");
});

test("claim logic: a spent or expired link has no form; other failures keep the form", () => {
  assert.equal(failureOf("auth.claim_used", false), "used");
  assert.equal(failureOf("auth.invalid_code", false), "used");
  assert.equal(failureOf("auth.expired", false), "expired");
  assert.equal(failureOf("validation.duplicate", false), "taken");
  assert.equal(failureOf("auth.claim_expired", false), "expired");
  assert.equal(failureOf("validation.username_taken", false), "taken");
  assert.equal(failureOf(null, true), "unreachable");
  assert.equal(isDeadLink("used"), true);
  assert.equal(isDeadLink("expired"), true);
  assert.equal(isDeadLink("invalid"), true);
  assert.equal(isDeadLink("taken"), false);
  assert.equal(FAILURE_LINE.used, "This link was already used.");
});

test("claim logic: Continue needs a name, a valid username, 8+ characters and a matching confirmation", () => {
  const ok = { name: "Irfad", username: "irfad", password: "longenough", confirm: "longenough" };
  assert.equal(problemOf(ok), null);
  assert.equal(problemOf({ ...ok, name: " " }), "name");
  assert.equal(problemOf({ ...ok, username: "9x" }), "username");
  assert.equal(problemOf({ ...ok, password: "short", confirm: "short" }), "password");
  assert.equal(problemOf({ ...ok, confirm: "different1" }), "mismatch");
});

test("claim logic: the token comes from /claim/<token> and nothing else", () => {
  assert.equal(claimToken("/claim/abcDEF123456"), "abcDEF123456");
  assert.equal(claimToken("/claim/abc"), null);
  assert.equal(claimToken("/home"), null);
  assert.equal(claimToken("/claim/abcDEF123456/extra"), null);
});

test("claim logic: the fingerprint in the link is grouped in fours for comparing", () => {
  assert.equal(fingerprintOf("#fp=ABCD1234ef567890"), "abcd 1234 ef56 7890");
  assert.equal(fingerprintOf("#other=1"), null);
  assert.equal(fingerprintOf(""), null);
});

test("claim logic: the Space id comes from the link fragment next to the fingerprint", () => {
  assert.equal(spaceIdOf("#fp=abcd1234&s=spc_core"), "spc_core");
  assert.equal(spaceIdOf("#s=spc_core&fp=abcd1234"), "spc_core");
  assert.equal(spaceIdOf("#fp=abcd1234"), null);
  assert.equal(spaceIdOf("#s=x"), null);
});

test("claim logic: the Space's name comes from the link fragment, decoded, and is null when absent or empty", () => {
  assert.equal(spaceNameOf("#fp=ab12cd34&s=spc_fresh&n=Fresh%20Co"), "Fresh Co");
  assert.equal(spaceNameOf("#n=Fresh+Co&s=spc_x"), "Fresh Co");
  assert.equal(spaceNameOf("#fp=ab12cd34&s=spc_fresh"), null);
  assert.equal(spaceNameOf("#n="), null);
});
