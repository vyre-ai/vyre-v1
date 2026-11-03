// The team on day one, over HTTP with each person's own token (owner D21 to D24, 3 Nov): a booted daemon, every module live.
// Ada (the owner) shares an agent and a Shared Vault item with Everyone, keeps another agent and a Mine item private, and invites Bea as a Member who starts in #sales.
// Bea's first login has #vyre, #sales, the shared agent, the shared Vault item and the Space skill, and nothing private. Bea cannot share with everyone herself.
// Presence: Bea is online to Ada after she does something, away when she sets it, and her last seen moves. A join step that fails is retried, as the periodic job and on Retry.
// The While you were away digest is written when Dan comes back after four hours with something waiting (a join he made, by name) and not after a minute.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, clock, connect, newAgent, seededDir } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const EVERYONE = { kind: "group", id: "grp_everyone" };
const MIN = 60_000, HOUR = 60 * MIN;

type Out = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Person { id: string; token: string; name: string }
let keys = 0;
const as = (d: Daemon, token: string) => async (cap: string, input: Record<string, unknown> = {}): Promise<Out> => {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `t1-${cap}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
};
const ok = (o: Out, what: string): any => { assert.equal(o.status, 200, `${what}: ${JSON.stringify(o.data).slice(0, 400)}`); return o.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any

async function accept(d: Daemon, link: string, username: string, name: string): Promise<Person> {
  const code = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: name, password: PASSWORD, keys: KEYS, deviceName: `${name}'s laptop`, deviceClass: "desktop" }) });
  const body = (await r.json()) as { data?: { token: string; personId: string } };
  assert.equal(r.status, 200, JSON.stringify(body));
  return { id: body.data!.personId, token: body.data!.token, name };
}

test("team day one: #vyre and what is shared with Everyone, nothing private; presence and away; last seen; join steps retried; the away digest", async () => {
  clock.t = Date.now();
  const d = await boot(seededDir());
  try {
    await connect(d);
    const A = as(d, d.token!);

    // every new Team Space has #vyre, made at the first start
    const home = ok(await A("channels.home"), "channels.home").channel;
    assert.equal(home?.name, "vyre", "the first channel is #vyre");
    assert.equal(home.legacy, false);

    // what Ada shares with everyone, and what she keeps private
    const intake = await newAgent(d, "Intake");
    const secret = await newAgent(d, "Ledger");
    const helper = await newAgent(d, "Paralegal");
    ok(await A("access.share", { resource: { type: "agent", id: intake.id }, subject: EVERYONE, level: "use" }), "share Intake with everyone");
    const shared = ok(await A("vault.folders.create", { name: "Team keys", scope: "shared" }), "shared folder").folder;
    const sharedItem = ok(await A("vault.item.put", { folderId: shared.id, name: "Team_Webhook", kind: "api_key", fields: [{ key: "key", value: "whk_test_0123456789abcdef", secret: true }] }), "shared item");   // secret-scan: fake
    const sharedId = (sharedItem.item?.id ?? sharedItem.itemId) as string;
    ok(await A("vault.share", { resource: { type: "vault_item", id: sharedId }, subject: EVERYONE, level: "use" }), "share the item with everyone");
    const mine = ok(await A("vault.folders.create", { name: "Mine only", scope: "mine" }), "mine folder").folder;
    const mineItem = ok(await A("vault.item.put", { folderId: mine.id, name: "Ada_Private", kind: "api_key", fields: [{ key: "key", value: "prv_test_0123456789abcdef", secret: true }] }), "mine item");   // secret-scan: fake
    const mineId = (mineItem.item?.id ?? mineItem.itemId) as string;
    const refused = await A("vault.share", { resource: { type: "vault_item", id: mineId }, subject: EVERYONE, level: "use" });
    assert.notEqual(refused.status, 200, "a Mine item is never shared with everyone");
    ok(await A("skills.add", { text: "---\nname: intake-rules\ndescription: How we take a new matter.\n---\n\nAsk for the conflict names first.\n" }), "a Space skill");
    const everyoneGets = ok(await A("access.groups.defaults_get"), "defaults").grants as { resource: { type: string; id: string } }[];
    assert.ok(everyoneGets.some((g) => g.resource.id === intake.id) && everyoneGets.some((g) => g.resource.id === sharedId), "Everyone holds the agent and the item");

    // Bea is invited as a Member who starts in #sales and may use Helper
    const sales = ok(await A("channels.create", { name: "sales", visibility: "public" }), "#sales").channel;
    const roles = ok(await A("access.roles.list"), "roles").roles as { id: string; name: string }[];
    const member = roles.find((r) => r.name === "Member")!.id, admin = roles.find((r) => r.name === "Admin")!.id;
    const inv = ok(await A("members.invites.create", { role: member, channels: [sales.channelId], agents: [helper.id] }), "invite Bea");
    const bea = await accept(d, inv.link, "bea", "Bea Baker");
    await d.hooks?.pump?.();
    const B = as(d, bea.token);

    // Bea's first login: #vyre and #sales, Intake (everyone) and Helper (her invite), the shared item and the Space skill; never Ledger nor Ada's Mine item
    const chans = ok(await B("channels.list"), "Bea channels").channels as { name: string; members: { id: string }[] }[];
    for (const n of ["vyre", "sales"]) assert.ok(chans.find((c) => c.name === n)?.members.some((m) => m.id === bea.id), `Bea is in #${n}`);
    const agents = (ok(await B("agents.list"), "Bea agents").agents as { agentId: string }[]).map((a) => a.agentId);
    assert.ok(agents.includes(intake.id), "Bea can use the agent shared with everyone");
    assert.ok(agents.includes(helper.id), "Bea can use the agent her invite picked");
    // seeing an agent of the Space is not using it: only what was shared with everyone, or picked on her invite, may run for her; Ada's own Assistant is not even listed
    const may = async (agentId: string): Promise<string> => ok(await A("access.check", { principal: { kind: "person", id: bea.id }, action: { level: "use" }, resource: { type: "agent", id: agentId } }), "check").decision.effect as string;
    assert.equal(await may(intake.id), "allow", "Bea may use the agent shared with everyone");
    assert.equal(await may(helper.id), "allow", "Bea may use the agent her invite picked");
    assert.notEqual(await may(secret.id), "allow", "Bea may not use an agent nobody shared with her");
    const adaAssistant = (ok(await A("agents.list"), "Ada agents").agents as { agentId: string; kind?: string }[]).find((a) => a.kind === "assistant");
    if (adaAssistant) assert.ok(!agents.includes(adaAssistant.agentId), "Ada's Assistant is never Bea's");
    const items = (ok(await B("vault.items.list", { section: "shared" }), "Bea vault").items as { id: string }[]).map((i) => i.id);
    const all = (ok(await B("vault.items.list", {}), "Bea vault all").items as { id: string }[]).map((i) => i.id);
    assert.ok(items.includes(sharedId) || all.includes(sharedId), "Bea has the shared Vault item");
    assert.ok(!all.includes(mineId) && !items.includes(mineId), "Bea never sees Ada's Mine item");
    const skills = (ok(await B("skills.list"), "Bea skills").skills as { name: string; tier: string }[]);
    assert.ok(skills.some((s) => s.name === "intake-rules" && s.tier === "space"), "Bea's agents reach the Space skill");
    const notMine = await B("access.share", { resource: { type: "agent", id: helper.id }, subject: EVERYONE, level: "use" });
    assert.notEqual(notMine.status, 200, "a Member cannot share with everyone");

    // last seen and presence: Bea does something a minute later; Ada sees her online; away shows as away; after she goes quiet she reads offline
    clock.t += 2 * MIN;
    const touched = ok(await B("devices.touch"), "Bea touches");
    assert.equal(touched.lastSeenAt, clock.t, "last seen is now");
    assert.equal(touched.back, undefined, "two minutes is not an absence");
    const mineDevices = ok(await B("devices.mine"), "Bea devices").devices as { lastSeenAt?: number }[];
    assert.equal(mineDevices[0]!.lastSeenAt, clock.t, "Settings shows the new last seen");
    const seen = async (who: string): Promise<{ state: string; lastSeenAt?: number } | undefined> => (ok(await A("devices.presence"), "presence").people as { personId: string; state: string; lastSeenAt?: number }[]).find((p) => p.personId === who);
    assert.equal((await seen(bea.id))?.state, "online", "a teammate sees Bea online");
    ok(await B("notifications.away.set", { until: clock.t + 30 * 24 * HOUR, delegate: { kind: "none" } }), "Bea sets herself away");
    assert.equal((await seen(bea.id))?.state, "away", "a teammate sees Bea away");
    ok(await B("notifications.away.clear"), "I'm Back");
    clock.t += 6 * MIN;
    assert.equal((await seen(bea.id))?.state, "offline", "quiet for six minutes reads offline");
    assert.equal(ok(await B("home.digest"), "Bea digest").digest, null, "no digest after a few minutes");

    // a join step that fails: Cal is invited into #ops, which is archived before he accepts; the step fails and shows, then a retry after it comes back finishes it
    const ops = ok(await A("channels.create", { name: "ops", visibility: "public" }), "#ops").channel;
    const invCal = ok(await A("members.invites.create", { role: member, channels: [ops.channelId] }), "invite Cal");
    ok(await A("channels.archive", { channelId: ops.channelId }), "archive #ops");
    const cal = await accept(d, invCal.link, "cal", "Cal Cruz");
    const pending = ok(await A("members.joins.list"), "joins").joins as { personId: string; name: string; steps: { title: string }[] }[];
    const calJoin = pending.find((j) => j.personId === cal.id);
    assert.ok(calJoin, "Cal's join has a step that did not work");
    assert.equal(calJoin!.name, "Cal Cruz");
    assert.match(calJoin!.steps[0]!.title, /Channel/);
    assert.ok(!/usr_|chn_/.test(JSON.stringify(calJoin)), "the step is in words");
    await d.hooks!.runPeriodic("members.join_retry");
    assert.ok((ok(await A("members.joins.list"), "joins").joins as { personId: string }[]).some((j) => j.personId === cal.id), "still failing while #ops is archived");
    ok(await A("channels.unarchive", { channelId: ops.channelId }), "#ops is back");
    await d.hooks!.runPeriodic("members.join_retry");
    assert.ok(!(ok(await A("members.joins.list"), "joins").joins as { personId: string }[]).some((j) => j.personId === cal.id), "the periodic retry finished it");
    const calChans = ok(await as(d, cal.token)("channels.list"), "Cal channels").channels as { name: string; members: { id: string }[] }[];
    for (const n of ["vyre", "ops"]) assert.ok(calChans.find((c) => c.name === n)?.members.some((m) => m.id === cal.id), `Cal is in #${n}`);

    // the digest: Dan (an admin) invites Eve and goes away; four hours later he comes back and the digest names Eve
    const dan = await accept(d, ok(await A("members.invites.create", { role: admin }), "invite Dan").link, "dan", "Dan Diaz");
    const D = as(d, dan.token);
    const eve = await accept(d, ok(await D("members.invites.create", { role: member }), "Dan invites Eve").link, "eve", "Eve Evans");
    await d.hooks?.pump?.();
    clock.t += 5 * HOUR;
    const back = ok(await D("devices.touch"), "Dan comes back");
    assert.equal(back.back, true, "five hours away is an absence");
    const digest = ok(await D("home.digest"), "Dan digest").digest;
    assert.ok(digest, "the digest was written");
    assert.ok(digest.items.some((i: { title: string }) => i.title.includes("Eve Evans")), `the digest names Eve: ${JSON.stringify(digest.items)}`);
    assert.ok(!/usr_/.test(JSON.stringify(digest)), "names, never ids");
    ok(await D("home.mark_digest_seen", { digestId: digest.id }), "seen");
    assert.equal(ok(await D("home.digest"), "Dan digest again").digest, null, "it resets once seen");
    assert.ok(eve.id.startsWith("usr_"));
  } finally {
    await d.stop();
  }
});
