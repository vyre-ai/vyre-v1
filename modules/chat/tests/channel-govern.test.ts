// An admin governs an invite-only channel they are not in: sees that it exists (Console, restricted), archives it, changes who is in it, and still reads and writes nothing in it.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, LEO, MAYA, codeOf, harness } from "../fixtures/harness.ts";

type Fn = (ctx: any, input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const key = (): string => `gv-${++n}`;
const admin = (hn: ReturnType<typeof harness>, id: string, allow = true) => ({ ...hn.person(id), authorize: () => ({ effect: allow ? "allow" : "deny" }) });

async function world() {
  const hn = harness({ calls: { "agents.get": () => ({ agent: {} }) } });
  const ch = (await h["channels.create"]!(hn.ctx, { name: "secret", visibility: "invite", memberIds: [MAYA], idempotencyKey: key() })).channel;
  await h["chat.post"]!(hn.ctx, { threadId: ch.mainThreadId, body: "hush", idempotencyKey: key() });
  return { hn, ch };
}

test("an admin sees the invite channel in Console marked restricted, and an ordinary list still hides it", async () => {
  const { hn, ch } = await world();
  const a = admin(hn, LEO);
  assert.deepEqual((await h["channels.list"]!(a, {})).channels, [], "the sidebar list hides it");
  const gov = (await h["channels.list"]!(a, { governance: true })).channels;
  assert.deepEqual(gov.map((c: any) => [c.channelId, c.restricted]), [[ch.channelId, true]]);
  assert.equal(gov[0].unread, 0, "no message counts");
  assert.deepEqual((await h["channels.list"]!(admin(hn, LEO, false), { governance: true })).channels, [], "a person who may not govern sees nothing more");
});

test("an admin archives the channel and changes who is in it, and still cannot read or write in it", async () => {
  const { hn, ch } = await world();
  const a = admin(hn, LEO);
  assert.equal((await h["channels.get"]!(a, { channelId: ch.channelId })).channel.name, "secret");
  await h["threads.members.add"]!(a, { threadId: ch.mainThreadId, personId: DANA === LEO ? MAYA : "usr_sam" });
  await h["threads.members.remove"]!(a, { threadId: ch.mainThreadId, personId: "usr_sam" });
  await h["channels.archive"]!(a, { channelId: ch.channelId });
  await h["channels.unarchive"]!(a, { channelId: ch.channelId });
  for (const [cap, input] of [["chat.messages.list", { threadId: ch.mainThreadId }], ["chat.post", { threadId: ch.mainThreadId, body: "hi", idempotencyKey: key() }], ["threads.get", { threadId: ch.mainThreadId }]] as const) {
    assert.equal(codeOf(await h[cap]!(a, input).catch((e: unknown) => e)), "validation.not_found", `${cap} stays closed`);
  }
  const denied = admin(hn, LEO, false);
  assert.equal(codeOf(await h["channels.archive"]!(denied, { channelId: ch.channelId }).catch((e: unknown) => e)), "validation.not_found", "without manage, not even that");
});
