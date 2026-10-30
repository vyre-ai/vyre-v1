import test from "node:test";
import assert from "node:assert/strict";
import { connections, createInviteLink, directory, importable, importPeople, probe, ssoProviders, stepDoneBy } from "./suite.ts";
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
  const dir = await directory(fake({ "google.directory.list": { people: [{ email: "a@x.y", name: "A", suspended: false }, { email: "b@x.y", suspended: true }, { email: "c@x.y", suspended: false, userId: "usr_c" }] } }).call);
  assert.equal(dir.kind === "ready" && dir.value.length, 3);
  assert.deepEqual(dir.kind === "ready" && importable(dir.value).map((p) => p.email), ["a@x.y"], "suspended and already-here people are not offered");
});

test("an invite link is made for the Member role and sends nothing", async () => {
  const f = fake({ "access.roles.list": { roles: [{ id: "rol_a", name: "Admin" }, { id: "rol_m", name: "Member" }] }, "members.invites.create": { link: "https://s/join/ABCD-EFGH#fp=1" } });
  assert.equal(await createInviteLink(f.call, "Member", "a@b.c", "k"), "https://s/join/ABCD-EFGH#fp=1");
  assert.deepEqual(f.calls[1], ["members.invites.create", { role: "rol_m", email: "a@b.c", idempotencyKey: "k" }]);
});

test("the import makes one invite per ticked person through each source's own capability and sends nothing", async () => {
  const f = fake({ "google.directory.import": { invited: [{ email: "a@x.y", inviteId: "inv_1", link: "https://s/join/AAAA-BBBB#fp=1" }], skipped: [] }, "ms.directory.import": { invited: [], skipped: [{ email: "m@x.y", reason: "already invited" }] } });
  const r = await importPeople(f.call, [{ email: "a@x.y", suspended: false, source: "google" }, { email: "m@x.y", suspended: false, source: "microsoft" }], "rol_member", "k");
  assert.deepEqual(f.calls.map(([c, i]) => [c, i.people, i.idempotencyKey]), [["google.directory.import", [{ email: "a@x.y", role: "rol_member" }], "k:google"], ["ms.directory.import", [{ email: "m@x.y", role: "rol_member" }], "k:microsoft"]]);
  assert.deepEqual([r.invited.length, r.skipped.length], [1, 1]);
  assert.ok(!f.calls.some(([c]) => /send|mail/.test(c)), "no send capability is called");
});
