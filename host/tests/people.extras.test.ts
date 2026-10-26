// The ctx extras the removal wizard and the Space tile use (P-L7_21): members.owned gathers every kind from the module that owns it and routes a plan step to that module, and spaces.attention adds
// Needs you from tasks and unread from chat, asked as the person, counting a module that is not live as zero.
import test from "node:test";
import assert from "node:assert/strict";
import { createPeopleExtras } from "../src/seams/people.ts";

type Call = { name: string; input: unknown; as: unknown };
function build(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const extras = createPeopleExtras({
    access: () => ({ info: () => null, groupsOf: () => [] }) as never,
    db: { all: () => [] },
    call: async (name, input, as) => {
      calls.push({ name, input, as });
      const a = answers[name];
      if (a instanceof Error) throw a;
      if (a === undefined) throw new Error(`${name} is not a host call (module not live)`);
      return a;
    },
  });
  return { calls, extras };
}
const admin = { principal: { kind: "person" as const, id: "usr_admin" } };

test("owned gathers files, channels, private chats, memory and mailbox connections from the modules that own them, and a module that is not live adds nothing", async () => {
  const { extras, calls } = build({
    "files.owned_by": { files: { count: 3, sample: [], ids: ["fil_1"] } },
    "chat.owned_by": { channels: { count: 1, sample: [], ids: ["chn_1"] }, private_chats: { count: 2, sample: [], ids: ["thr_1"] } },
    "memory.owned_by": { memory_from_you: { count: 4, sample: [], ids: [] } },
    "mail.owned_by": { mailbox_connections: { count: 1, sample: [], ids: ["mbx_1"] } },
  });
  const owned = (extras("members", {}) as { owned: { of(p: string): Promise<Record<string, { count: number }>> } }).owned;
  const seen = await owned.of("usr_pat");
  assert.deepEqual(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.count])), { files: 3, channels: 1, private_chats: 2, memory_from_you: 4, mailbox_connections: 1 });
  assert.ok(calls.some((c) => c.name === "chat.owned_by"), "chat is asked once for both of its kinds");
  assert.equal(calls.filter((c) => c.name === "chat.owned_by").length, 1);
  void admin;
});

test("a plan step goes to the module of its kind: files and channels and private chats and memory and mailboxes each reach their own reassign_owned", async () => {
  const { extras, calls } = build({
    "files.reassign_owned": 5, "chat.reassign_owned": 2, "memory.reassign_owned": 4, "mail.reassign_owned": 1,
  });
  const owned = (extras("members", {}) as { owned: { apply(p: string, kind: string, action: string, to?: string): Promise<number> } }).owned;
  assert.equal(await owned.apply("usr_pat", "files", "reassign", "usr_admin"), 5);
  assert.equal(await owned.apply("usr_pat", "channels", "reassign", "usr_admin"), 2);
  assert.equal(await owned.apply("usr_pat", "private_chats", "delete"), 2);
  assert.equal(await owned.apply("usr_pat", "memory_from_you", "delete"), 4);
  assert.equal(await owned.apply("usr_pat", "mailbox_connections", "revoke"), 1);
  assert.deepEqual(calls.map((c) => c.name), ["files.reassign_owned", "chat.reassign_owned", "chat.reassign_owned", "memory.reassign_owned", "mail.reassign_owned"]);
  assert.deepEqual(calls[0]!.input, { person: "usr_pat", kind: "files", action: "reassign", to: "usr_admin" });
  assert.equal(await owned.apply("usr_pat", "nonesuch", "reassign"), 0);
});

test("attention is Needs you from tasks plus unread from chat, asked as the person, with a module that is not live counting zero and a bad answer counting zero", async () => {
  const live = build({ "tasks.attention": 3, "chat.attention": 7 });
  const a = (live.extras("spaces", {}) as { attention: { of(p: string): Promise<{ needsYou: number; unread: number }> } }).attention;
  assert.deepEqual(await a.of("usr_maya"), { needsYou: 3, unread: 7 });
  assert.deepEqual(live.calls.map((c) => [c.name, c.as]), [["tasks.attention", { principal: { kind: "person", id: "usr_maya" } }], ["chat.attention", { principal: { kind: "person", id: "usr_maya" } }]]);
  const partly = build({ "tasks.attention": 2 });
  const b = (partly.extras("spaces", {}) as { attention: { of(p: string): Promise<{ needsYou: number; unread: number }> } }).attention;
  assert.deepEqual(await b.of("usr_maya"), { needsYou: 2, unread: 0 });
  const odd = build({ "tasks.attention": -4, "chat.attention": "x" });
  const c = (odd.extras("spaces", {}) as { attention: { of(p: string): Promise<{ needsYou: number; unread: number }> } }).attention;
  assert.deepEqual(await c.of("usr_maya"), { needsYou: 0, unread: 0 });
});
