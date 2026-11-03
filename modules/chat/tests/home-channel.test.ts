// The Space's first channel (owner D22, 3 Nov): every Team Space has #vyre, with everyone already in the Space; a new member joins it as a step of their join. An older Space keeps its
// #general (Console offers the rename) and gets no second channel. A Personal Space has none. Only another capability may run the join step.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, DANA, LEO, MAYA } from "../fixtures/harness.ts";
import { handlers } from "../handlers/index.ts";
import { ensureHome } from "../handlers/home-channel.ts";

const team = (kind = "team") => ({
  "spaces.get": () => ({ space: { id: "spc_chattest", name: "Northwind", kind, owner: DANA } }),
  "access.principals.list": () => ({ principals: [{ id: DANA, kind: "person", status: "active" }, { id: MAYA, kind: "person", status: "active" }] }),
});
const members = (h: ReturnType<typeof harness>, thread: string): string[] => (h.rows("SELECT principal FROM chat_thread_member WHERE thread = ? AND deleted_at IS NULL", thread) as { principal: string }[]).map((r) => r.principal).sort();

test("a Team Space gets #vyre, public, with everyone already in it; a second run changes nothing", async () => {
  const h = harness({ calls: team(), principal: { kind: "service", id: "svc_host" } });
  const made = await ensureHome(h.ctx);
  assert.equal(made?.made, true);
  assert.equal(made?.channel.name, "vyre");
  assert.equal(made?.channel.visibility, "public");
  assert.deepEqual(members(h, made!.channel.mainThread), [MAYA, DANA].sort());
  assert.deepEqual(h.names().filter((n) => n === "channel.created"), ["channel.created"]);
  h.clear();
  const again = await ensureHome(h.ctx);
  assert.equal(again?.made, false);
  assert.equal(h.named("channel.created").length, 0, "no second #vyre");
  const home = await handlers["channels.home"](h.person(MAYA), {} as never) as { channel: { name: string; legacy: boolean } };
  assert.deepEqual({ name: home.channel.name, legacy: home.channel.legacy }, { name: "vyre", legacy: false });
});

test("an older Space with #general keeps it: no #vyre is made, and channels.home says it is the legacy name", async () => {
  const h = harness({ calls: team() });
  await handlers["channels.create"](h.ctx, { name: "general", visibility: "public" } as never);
  const out = await ensureHome(h.as({ kind: "service", id: "svc_host" }));
  assert.equal(out?.made, false);
  assert.equal(out?.channel.name, "general");
  const home = await handlers["channels.home"](h.ctx, {} as never) as { channel: { name: string; legacy: boolean } };
  assert.deepEqual({ name: home.channel.name, legacy: home.channel.legacy }, { name: "general", legacy: true });
});

test("a Personal Space has no first channel", async () => {
  const h = harness({ calls: team("personal") });
  assert.equal(await ensureHome(h.ctx), null);
  assert.deepEqual(await handlers["channels.home"](h.ctx, {} as never), { channel: null });
});

test("the join step puts a new member in #vyre (making it when it is missing), once; a person cannot call it", async () => {
  const h = harness({ calls: team() });
  const sys = { ...h.as({ kind: "service", id: "svc_members" }), depth: 1 };
  const first = await handlers["channels.home_join"](sys, { personId: LEO } as never) as { channelId: string; added: boolean };
  assert.equal(first.added, true);
  const ch = h.rows("SELECT mainThread FROM chat_channel WHERE id = ?", first.channelId)[0] as { mainThread: string };
  assert.ok(members(h, ch.mainThread).includes(LEO));
  const twice = await handlers["channels.home_join"](sys, { personId: LEO } as never) as { added: boolean };
  assert.equal(twice.added, false, "a retry adds nobody twice");
  await assert.rejects(handlers["channels.home_join"]({ ...h.person(LEO), depth: 0 }, { personId: LEO } as never), "a direct call is refused");
});
