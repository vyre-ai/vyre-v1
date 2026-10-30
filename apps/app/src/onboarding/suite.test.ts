import test from "node:test";
import assert from "node:assert/strict";
import { connections, createInviteLink, directory, probe, ssoProviders, stepDoneBy } from "./suite.ts";
import type { CapCall } from "../shell/session/caps.ts";

const fake = (answers: Record<string, unknown>) => { const calls: Array<[string, any]> = []; return { calls, call: (async (c: string, i: any) => { calls.push([c, i]); if (!(c in answers)) throw Object.assign(new Error("no"), { code: "validation.unknown_capability" }); const a = answers[c]; if (a instanceof Error) throw a; return a; }) as unknown as CapCall }; };

test("a capability the Space does not have reads not set up yet, a real failure reads failed", async () => {
  assert.deepEqual(await probe(fake({}).call, "x.y"), { kind: "not_yet" });
  assert.deepEqual(await probe(fake({ "x.y": Object.assign(new Error("boom"), { code: "internal.unexpected" }) }).call, "x.y"), { kind: "failed" });
});

test("Google is done when configured and the live test passed; Microsoft when configured and consent is given", async () => {
  const a = await connections(fake({ "google.dwd.status": { configured: true, lastProbeOk: true }, "ms.consent.status": { configured: true, consentGiven: false } }).call);
  assert.equal(a.google.kind === "ready" && a.google.value.ok, true);
  assert.equal(a.microsoft.kind === "ready" && a.microsoft.value.ok, false);
  assert.equal(stepDoneBy(a), true);
  const none = await connections(fake({ "google.dwd.status": { configured: false, lastProbeOk: null } }).call);
  assert.equal(stepDoneBy(none), false);
  assert.equal(none.microsoft.kind, "not_yet");
  assert.match((none.google as any).value.note, /Not set up/);
});

test("sign-in providers and the directory come from the suite's names and are honest when absent", async () => {
  assert.deepEqual(await ssoProviders(fake({ "members.sso.list": { providers: [{ provider: "google" }] } }).call), { kind: "ready", value: [{ provider: "google" }] });
  assert.equal((await directory(fake({}).call)).kind, "not_yet");
  assert.deepEqual(await directory(fake({ "google.directory.list": { people: [1, 2, 3] } }).call), { kind: "ready", value: { people: 3 } });
});

test("an invite link is made for the Member role and sends nothing", async () => {
  const f = fake({ "access.roles.list": { roles: [{ id: "rol_a", name: "Admin" }, { id: "rol_m", name: "Member" }] }, "members.invites.create": { link: "https://s/join/ABCD-EFGH#fp=1" } });
  assert.equal(await createInviteLink(f.call, "Member", "a@b.c", "k"), "https://s/join/ABCD-EFGH#fp=1");
  assert.deepEqual(f.calls[1], ["members.invites.create", { role: "rol_m", email: "a@b.c", idempotencyKey: "k" }]);
});
