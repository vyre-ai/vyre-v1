import test from "node:test";
import assert from "node:assert/strict";
import { connections, createInviteLink, directory, draftInvites, importable, importPeople, ownMailbox, probe, sendDrafts, ssoProviders, stepDoneBy } from "./suite.ts";
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
  assert.equal(dir.kind === "ready" && dir.value.people.length, 3);
  assert.deepEqual(dir.kind === "ready" && importable(dir.value.people).map((p) => p.email), ["a@x.y"], "suspended and already-here people are not offered");
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

test("a big directory pages: the next page is read with each source's own token, a source with no more pages is not asked again", async () => {
  const f = fake({
    "google.directory.list": { people: [{ email: "a@x.y", suspended: false }], nextPageToken: "g2" },
    "ms.directory.list": { people: [{ email: "m@x.y", suspended: false }] },
  });
  const p1 = await directory(f.call);
  assert.deepEqual(p1.kind === "ready" && p1.value.next, { google: "g2" });
  const p2 = await directory(f.call, { google: "g2" });
  assert.equal(p2.kind, "ready");
  assert.deepEqual(f.calls.map(([c, i]) => [c, i]), [["google.directory.list", {}], ["ms.directory.list", {}], ["google.directory.list", { pageToken: "g2" }]], "Microsoft had no next page, so it is not asked");
});

test("invite emails: one draft per person with the link, who invited them and what Vyre is; one press sends each through the send API", async () => {
  const drafts = draftInvites([{ email: "a@x.y", link: "https://s/join/AAAA-BBBB#fp=1" }, { email: "b@x.y", link: "https://s/join/CCCC-DDDD#fp=2" }], new Map([["a@x.y", "Ada Lovelace"]]), "Dana Reyes", "Northwind");
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]!.subject, "Dana Reyes invited you to Northwind on Vyre");
  assert.match(drafts[0]!.text, /^Hi Ada,/);
  assert.match(drafts[0]!.text, /https:\/\/s\/join\/AAAA-BBBB#fp=1/);
  assert.match(drafts[0]!.text, /shared workspace/);
  assert.match(drafts[1]!.text, /^Hi,/);
  assert.ok(!drafts.some((d) => /\u2014|\u00a7/.test(d.text + d.subject)));
  const f = fake({ "mail.mailbox.list": { mailboxes: [{ id: "mbx_1", kind: "personal", address: "dana@x.y", state: "syncing" }] }, "mail.send": { status: "queued", suppressed: [] } });
  const box = await ownMailbox(f.call);
  assert.deepEqual(box, { mailboxId: "mbx_1", address: "dana@x.y" });
  const out = await sendDrafts(f.call, box!, drafts, "k");
  assert.deepEqual(out.map((o) => [o.to, o.status]), [["a@x.y", "queued"], ["b@x.y", "queued"]]);
  assert.deepEqual(f.calls.filter(([c]) => c === "mail.send").map(([, i]) => [i.mailboxId, i.to[0].address, i.idempotencyKey]), [["mbx_1", "a@x.y", "k:a@x.y"], ["mbx_1", "b@x.y", "k:b@x.y"]]);
  assert.equal(await ownMailbox(fake({ "mail.mailbox.list": { mailboxes: [] } }).call), null, "no mailbox: the card keeps the links");
});

test("a send the Gate holds or one that fails is reported per person and does not stop the rest", async () => {
  let n = 0;
  const call = (async (c: string) => { if (c !== "mail.send") return {}; n++; if (n === 1) return { status: "held", suppressed: [] }; if (n === 2) throw new Error("no"); return { status: "sent", suppressed: [] }; }) as never;
  const out = await sendDrafts(call, { mailboxId: "m", address: "a" }, [{ to: "1@x.y", subject: "s", text: "t" }, { to: "2@x.y", subject: "s", text: "t" }, { to: "3@x.y", subject: "s", text: "t" }], "k");
  assert.deepEqual(out.map((o) => o.status), ["held", "failed", "sent"]);
});
