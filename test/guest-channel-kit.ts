// The world the guest-of-a-channel live tests share (lane f-guest, 13 Nov 2026): one Space with an owner, a second member, three channels (public, invite-only, and one the guest is never added to), their agents, and an
// invite that joins a guest at a level through the product's own invite and accept doors.
import fs from "node:fs";
import assert from "node:assert/strict";
import { boot, seededDir, waitFor } from "./memory-live-kit.ts";
import { PASSWORD, api, join, ok, standIn } from "./member-key-kit.ts";
import { makeBundle } from "../client/src/crypto/keys.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

export async function joinGuest(d: Daemon, link: string, username: string): Promise<{ personId: string; token: string }> {
  const code = decodeURIComponent(new URL(link).pathname.split("/").pop()!);
  const made = await makeBundle(PASSWORD, "recovery-code-for-the-test", { spaceId: "spc_member_key" });
  const { personKey: _k, ...rest } = made;
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: username, password: PASSWORD, deviceName: `${username}'s Mac`, deviceClass: "desktop", keys }) });
  assert.equal(r.status, 200, await r.clone().text());
  return ((await r.json()) as { data: { personId: string; token: string } }).data;
}

/** One Space: an owner, a public channel and an invite-only channel (each with a message), another channel the guest is not in, and one guest per level and kind. */
export async function world() {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  const o = (cap: string, input: Record<string, unknown> = {}) => ok(d, d.token, cap, input);
  const agent = (await o("agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
  const maya = await join(d, "maya", "maya@example.com");
  const mk = async (name: string, visibility: "public" | "invite", memberIds: string[] = []) => (await o("channels.create", { name, visibility, memberIds, agentIds: [agent] })).channel as { channelId: string; mainThreadId: string };
  const otherAgent = (await o("agents.create", { name: "Ledger", role: "You keep books." })).agent.agentId as string;
  const pub = await mk("partners", "public"), priv = await mk("deal-room", "invite"), other = await mk("internal", "public", [maya.personId]);
  const say = async (c: { mainThreadId: string }, body: string) => { const out = await o("chat.post", { threadId: c.mainThreadId, body }); return (out.messageId ?? out.message?.messageId ?? out.message?.id) as string; };
  const first = { pub: await say(pub, "Welcome to partners."), priv: await say(priv, "Welcome to the deal room.") };
  await say(other, "Internal only.");
  const invite = async (c: { mainThreadId: string }, level: "view" | "reply", email: string, username: string) => {
    const inv = await o("threads.invite_guest", { threadId: c.mainThreadId, email, level });
    const g = await joinGuest(d, inv.link as string, username);
    // the join steps (role, channel, grant) apply after accept: wait until the guest's own channel read answers
    await waitFor(async () => ((await api(d, g.token, "channels.get", { channelId: c.channelId })).status === 200 ? true : null), 20_000);
    return { ...g, personId: g.personId, call: (cap: string, input: Record<string, unknown> = {}) => api(d, g.token, cap, { idempotencyKey: `g-${Math.random()}`, ...input }) };
  };
  return { d, dir, o, maya, say, pub, priv, other, first, agent, otherAgent, invite, stop: async () => { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

