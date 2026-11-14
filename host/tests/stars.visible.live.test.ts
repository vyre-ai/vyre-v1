// Starring and following go through the real daemon: a chat, a thread and a channel the caller can see star; a private chat of someone else and an invite-only channel they are not in answer "not found" (the same as an id that does not exist), by the id the sidebar really sends (a channel id for a channel).
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

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";
const SPACE = "spc_starvisible";

function bootOn(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(
      [
        "--data-dir",
        dir,
        "--port",
        "0",
        "--space",
        SPACE,
        "--space-name",
        "Team Channel Co",
        "--address",
        "team.example.com",
      ],
      {},
      "1.2.3",
    ),
    platform: fakePlatform({
      os: "linux",
      hostname: "team-channel",
      free: 80e9,
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

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

test("stars: a visible chat, a visible thread and a channel star; a hidden chat and a channel the caller is not in are not found, like a made-up id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-star-visible-"));
  const d = await bootOn(dir);
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    await post(d, "/v1/identity/claim_owner", {
      code,
      spaceId: SPACE,
      username: "olivia",
      displayName: "Olivia",
      password: PASSWORD,
      ...device,
      keys: KEYS,
    });
    const owner = (await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device })).json
      .data.session.token as string;
    const invite = await post(
      d,
      "/v1/members/invites/create",
      { role: "rol_member", idempotencyKey: "star-invite" },
      owner,
    );
    const inviteCode = decodeURIComponent(new URL(invite.json.data.link as string).pathname.split("/").pop() ?? "");
    const joined = await post(d, "/v1/members/accept", {
      code: inviteCode,
      username: "ruby",
      password: PASSWORD,
      deviceName: "Browser",
      deviceClass: "desktop",
      keys: KEYS,
    });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    const ruby = joined.json.data.token as string;
    const who = await post(d, "/v1/identity/whoami", {}, owner);
    const ownerId = who.json.data?.principal?.id as string;
    assert.match(String(ownerId), /^usr_/, JSON.stringify(who.json));
    const inviteSam = await post(
      d,
      "/v1/members/invites/create",
      { role: "rol_member", idempotencyKey: "star-invite-2" },
      owner,
    );
    const samCode = decodeURIComponent(new URL(inviteSam.json.data.link as string).pathname.split("/").pop() ?? "");
    const sam = await post(d, "/v1/members/accept", {
      code: samCode,
      username: "sam",
      password: PASSWORD,
      deviceName: "Browser",
      deviceClass: "desktop",
      keys: KEYS,
    });
    assert.equal(sam.status, 200, JSON.stringify(sam.json));
    const mine = await post(
      d,
      "/v1/chat/start",
      { kind: "chat", agentIds: [], personId: ownerId, idempotencyKey: "star-own" },
      ruby,
    );
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    const hidden = await post(
      d,
      "/v1/chat/start",
      { kind: "chat", agentIds: [], personId: sam.json.data.personId, idempotencyKey: "star-hidden" },
      owner,
    );
    assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
    const open = (
      await post(d, "/v1/channels/create", { name: "town", visibility: "public", idempotencyKey: "star-open" }, owner)
    ).json.data.channel as { channelId: string };
    const closed = (
      await post(
        d,
        "/v1/channels/create",
        { name: "board", visibility: "invite", idempotencyKey: "star-closed" },
        owner,
      )
    ).json.data.channel as { channelId: string };
    const star = (resource: { type: string; id: string }, on = true) =>
      post(d, "/v1/stars/toggle", { resource, on, idempotencyKey: `s-${resource.id}-${on}` }, ruby);

    const ownStar = await star({ type: "thread", id: mine.json.data.thread.threadId });
    assert.equal(ownStar.status, 200, JSON.stringify(ownStar.json));
    assert.equal(ownStar.json.data.starred, true, "my own chat stars");
    const channelStar = await star({ type: "channel", id: open.channelId });
    assert.equal(
      channelStar.status,
      200,
      `a channel stars by its channel id (what the sidebar sends): ${JSON.stringify(channelStar.json)}`,
    );
    assert.equal(channelStar.json.data.starred, true);

    const hiddenStar = await star({ type: "thread", id: hidden.json.data.thread.threadId });
    const madeUp = await star({ type: "thread", id: "thr_madeupidthatnoneowns" });
    assert.notEqual(hiddenStar.status, 200, "a chat that is not mine is not found");
    assert.equal(
      hiddenStar.json.error?.code,
      madeUp.json.error?.code,
      `the same answer as an id that does not exist (${JSON.stringify([hiddenStar.status, hiddenStar.json.error?.code, madeUp.status, madeUp.json.error?.code])})`,
    );
    const closedStar = await star({ type: "channel", id: closed.channelId });
    assert.notEqual(closedStar.status, 200, "an invite-only channel I am not in is not found");
    assert.equal(
      (await post(d, "/v1/stars/list", {}, ruby)).json.data.stars.length,
      2,
      "only the two real stars are kept",
    );
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
