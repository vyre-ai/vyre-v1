// A guest invited to a channel that was made BEFORE a channel's chat lived in its channel (lane f-guest, 13 Nov 2026): the first call that names an old thread moves it into its home, once, from the chat's own rows and never
// from the caller; two calls at once are fine; a guest of channel A who names a thread of channel B is still refused; and a restart changes nothing.
// By default the test makes the Space and uses it in the same tree. To prove the real upgrade, run `phase make` on rc.26 (VYRE_UPGRADE_PHASE=make VYRE_UPGRADE_DIR=<dir>) and `use` on this tree on that same directory.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, seededDir, waitFor } from "./memory-live-kit.ts";
import { api, ok, standIn } from "./member-key-kit.ts";
import { joinGuest } from "./guest-channel-kit.ts";

type Ids = { old: { token: string; personId: string }; a: { mainThreadId: string; channelId: string; reply: string; msg: string }; b: { mainThreadId: string; channelId: string; reply: string } };

async function make(dir: string): Promise<Ids> {
  const d = await boot(dir, standIn);
  try {
    const o = (cap: string, input: Record<string, unknown> = {}) => ok(d, d.token, cap, input);
    const one = async (name: string) => {
      const c = (await o("channels.create", { name, visibility: "public", memberIds: [], agentIds: [] })).channel as { channelId: string; mainThreadId: string };
      const out = await o("chat.post", { threadId: c.mainThreadId, body: `Hello in ${name}` });
      const msg = (out.messageId ?? out.message?.messageId ?? out.message?.id) as string;
      const reply = (await o("chat.thread", { threadId: c.mainThreadId, messageId: msg })).thread.threadId as string;
      await o("chat.post", { threadId: reply, body: `A side thread in ${name}` });
      return { ...c, reply, msg };
    };
    const a = await one("partners"), b = await one("internal");
    // a guest invited on the old code: a bare grant on the channel, as every guest of rc.26 holds
    const inv = await o("threads.invite_guest", { threadId: a.mainThreadId, email: "rc26@example.com", level: "reply" });
    const g = await joinGuest(d, inv.link as string, "rcguest");
    await waitFor(async () => ((await api(d, g.token, "channels.get", { channelId: a.channelId })).status === 200 ? true : null), 20_000);
    return { old: { token: g.token, personId: g.personId }, a, b: { mainThreadId: b.mainThreadId, channelId: b.channelId, reply: b.reply } };
  } finally { await d.stop(); }
}

async function use(dir: string, ids: Ids): Promise<void> {
  let d = await boot(dir, standIn);
  try {
    const inv = await ok(d, d.token, "threads.invite_guest", { threadId: ids.a.mainThreadId, email: "old@example.com", level: "reply" });
    const g = await joinGuest(d, inv.link as string, "oldguest");
    await waitFor(async () => ((await api(d, g.token, "channels.get", { channelId: ids.a.channelId })).status === 200 ? true : null), 20_000);
    const as = (dd: typeof d) => (cap: string, input: Record<string, unknown> = {}) => api(dd, g.token, cap, { idempotencyKey: `u-${Math.random()}`, ...input });
    const call = as(d);
    // a guest of A naming B's threads first: refused, and nothing about B is left in a state that helps them
    for (const id of [ids.b.mainThreadId, ids.b.reply]) for (const cap of ["threads.get", "chat.messages.list"]) assert.equal((await call(cap, { threadId: id })).status, 403, `${cap} on a thread of the other channel`);
    // several calls at once on A's reply thread, which names a thread nobody has opened since the upgrade
    const races = await Promise.all(Array.from({ length: 6 }, () => call("threads.get", { threadId: ids.a.reply })));
    assert.deepEqual(races.map((r) => r.status), [200, 200, 200, 200, 200, 200], "six calls at once all open the old reply thread");
    assert.equal((await call("threads.get", { threadId: ids.a.mainThreadId })).status, 200);
    assert.equal((await call("chat.post", { threadId: ids.a.reply, body: "from the guest" })).status, 200, "and a reply guest posts in it");
    for (const id of [ids.b.mainThreadId, ids.b.reply]) assert.equal((await call("threads.get", { threadId: id })).status, 403, "B is still closed after A was moved");
    // the guest invited on the old code, with no new invite: the table and nothing more
    const oldCall = (cap: string, input: Record<string, unknown>) => api(d, ids.old.token, cap, { idempotencyKey: `o-${Math.random()}`, ...input });
    assert.equal((await oldCall("threads.get", { threadId: ids.a.mainThreadId })).status, 200, "the old guest opens the old channel");
    assert.equal((await oldCall("chat.post", { threadId: ids.a.reply, body: "from the old guest" })).status, 200, "and replies in an old reply thread");
    for (const [cap, input] of [["engine.stop_all", { threadId: ids.a.mainThreadId }], ["chat.helper.start", { threadId: ids.a.mainThreadId, title: "t", instruction: "i" }], ["chat.handoff", { threadId: ids.a.mainThreadId, toAgentId: "agt_x", note: "go" }], ["threads.set_mode", { threadId: ids.a.mainThreadId, mode: "auto" }], ["terminal.request", { threadId: ids.a.mainThreadId, command: "ls", why: "look" }]] as const) {
      const r = await oldCall(cap, input);
      assert.equal(r.status, 403, `the old guest is held to the table: ${cap} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    }
    // a restart changes nothing
    await d.stop();
    d = await boot(dir, standIn);
    const again = as(d);
    for (const id of [ids.a.mainThreadId, ids.a.reply]) assert.equal((await again("threads.get", { threadId: id })).status, 200, "after a restart");
    for (const id of [ids.b.mainThreadId, ids.b.reply]) assert.equal((await again("threads.get", { threadId: id })).status, 403, "and B stays closed");
  } finally { await d.stop(); }
}

test("a guest of a channel made before the move opens its chat and reply threads, and no other channel's", async () => {
  const phase = process.env["VYRE_UPGRADE_PHASE"], keep = process.env["VYRE_UPGRADE_DIR"];
  if (phase === "make") { assert.ok(keep); fs.rmSync(keep, { recursive: true, force: true }); const dir = seededDir(); const ids = await make(dir); fs.cpSync(dir, keep, { recursive: true }); fs.writeFileSync(path.join(keep, "ids.json"), JSON.stringify(ids)); fs.rmSync(dir, { recursive: true, force: true }); return; }
  if (phase === "use") { assert.ok(keep); const ids = JSON.parse(fs.readFileSync(path.join(keep, "ids.json"), "utf8")) as Ids; const dir = seededDir(); fs.cpSync(keep, dir, { recursive: true }); try { await use(dir, ids); } finally { fs.rmSync(dir, { recursive: true, force: true }); } return; }
  const dir = seededDir();
  try { await use(dir, await make(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
