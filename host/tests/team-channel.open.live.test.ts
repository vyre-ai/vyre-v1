// Live bug (rc.14 team Space): creating a private channel opened a pane that never left the loading mark. The client opened the channel by its channel id (chn_) where the thread
// capabilities expect its main thread (thr_), so threads.get, chat.messages.list and chat.helpers.list refused it on every open. This proves the server half: a channel resolves to its main
// thread, and every read the pane makes answers for the owner and, once added, for a member. The client half is in apps/app (ChatsMounted resolves chn_ through channels.get).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const SPACE = "spc_teamchan";

function bootOn(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", SPACE, "--space-name", "Team Channel Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "team-channel", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};


test("a private channel opens as its main thread for the owner and, once added, for a member: every read the pane makes answers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-team-channel-"));
  const d = await bootOn(dir);
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    assert.equal((await post(d, "/v1/identity/claim_owner", { code, spaceId: SPACE, username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const owner = (await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device })).json.data.session.token as string;
    const invite = await post(d, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "team-channel-invite" }, owner);
    const inviteCode = decodeURIComponent(new URL(invite.json.data.link as string).pathname.split("/").pop() ?? "");
    const joined = await post(d, "/v1/members/accept", { code: inviteCode, username: "ruby", password: PASSWORD, deviceName: "Browser", deviceClass: "desktop", keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    const member = { id: joined.json.data.personId as string, token: joined.json.data.token as string };

    const made = await post(d, "/v1/channels/create", { name: "test", visibility: "invite", idempotencyKey: "team-channel-create" }, owner);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const channel = made.json.data.channel as { channelId: string; mainThreadId: string };
    assert.match(channel.channelId, /^chn_/);
    assert.match(channel.mainThreadId, /^thr_/, "the channel names its main thread, which is what the pane opens");

    // the cause of the endless pane: a channel id where a thread id is expected is refused
    const wrong = await post(d, "/v1/threads/get", { threadId: channel.channelId }, owner);
    assert.notEqual(wrong.status, 200, "threads.get does not take a channel id");
    // what the client does with the id it was given: the channel id resolves to the main thread
    const got = await post(d, "/v1/channels/get", { channelId: channel.channelId }, owner);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    assert.equal(got.json.data.channel.mainThreadId, channel.mainThreadId);

    // every read the conversation pane makes, as the person opening it
    const paneReads = async (token: string, who: string): Promise<void> => {
      const reads: Array<[string, unknown]> = [
        ["/v1/threads/get", { threadId: channel.mainThreadId }],
        ["/v1/chat/messages/list", { threadId: channel.mainThreadId }],
        ["/v1/chat/helpers/list", { threadId: channel.mainThreadId }],
        ["/v1/runs/list", { scope: "subject", subject: { type: "thread", id: channel.mainThreadId }, statuses: ["queued", "running", "waiting"] }],
      ];
      for (const [p, body] of reads) {
        const r = await post(d, p, body, token);
        assert.equal(r.status, 200, `${who} ${p}: ${JSON.stringify(r.json)}`);
      }
    };
    await paneReads(owner, "owner");
    assert.equal((await post(d, "/v1/chat/post", { threadId: channel.mainThreadId, body: "First note in the channel.", idempotencyKey: "team-channel-post" }, owner)).status, 200);

    // the member cannot see the private channel until added; then the same reads answer
    assert.notEqual((await post(d, "/v1/threads/get", { threadId: channel.mainThreadId }, member.token)).status, 200, "a private channel is not the member's before they are added");
    // and the refusal in the log says whose it was, in the columns a query filters on (the live log had no actor on refusals)
    d.sink.flush();
    const logs = new DatabaseSync(d.paths.logs, { readOnly: true });
    try {
      const row = logs.prepare("SELECT actor, result, attrs FROM logs WHERE msg = 'invoke' AND cap = 'threads.get' AND actor = ? ORDER BY id DESC LIMIT 1").get(member.id) as { actor: string; result: string; attrs: string } | undefined;
      assert.ok(row, "the refused threads.get names the member as its actor");
      assert.match(row.result, /^(permission|validation)\./);
      assert.ok(!row.attrs.includes(member.id), "the person's id is in the actor column only, where erasure can reach it");
    } finally { logs.close(); }
    const added = await post(d, "/v1/channels/members/add", { channelId: channel.channelId, personIds: [member.id] }, owner);
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.equal((await post(d, "/v1/channels/get", { channelId: channel.channelId }, member.token)).json.data?.channel?.mainThreadId, channel.mainThreadId);
    await paneReads(member.token, "member");
    const msgs = await post(d, "/v1/chat/messages/list", { threadId: channel.mainThreadId }, member.token);
    assert.ok((msgs.json.data.messages as Array<{ body: string }>).some((m) => m.body === "First note in the channel."), "the member reads the owner's post");
  } finally { await d.stop(); }
});
