// P-GF_10 (ruling 88): the owner of an agent made through agents.create manages the agent's folder from the start, so they can approve memory into it; when the removal wizard reassigns the agent
// the folder's ownership follows, and the previous owner keeps nothing on it. The people here hold the Guest role (no Space-wide grant), so folder access can only come from the agent's own grant.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
type Json = { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any

test("the owner of a new agent can approve memory into it; after a reassign the new owner can and the old owner has nothing", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-agent-owner-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "agent-owner", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (token: string, p: string, body: unknown): Promise<{ status: number; body: Json }> => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) as Json : {} };
  };
  const owner = d.token;   // the local admin token acts as the Space owner
  const join = async (name: string): Promise<{ id: string; token: string }> => {
    const invite = await post(owner, "/v1/members/invites/create", { role: "rol_guest", idempotencyKey: `gf10-invite-${name}` });
    assert.equal(invite.status, 200, JSON.stringify(invite.body));
    const code = decodeURIComponent(new URL(invite.body.data.link as string).pathname.split("/").pop() ?? "");
    const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username: name, password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS }) });
    const body = (await r.json()) as Json;
    assert.equal(r.status, 200, JSON.stringify(body));
    return { id: body.data.personId as string, token: body.data.token as string };
  };
  try {
    const first = await join("firstowner"), asker = await join("asker"), heir = await join("heir");
    const made = await post(owner, "/v1/agents/create", { name: "Scout Two", ownerId: first.id, idempotencyKey: "gf10-agent" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const agent = made.body.data.agent as { id: string; folderId: string };

    const sharesOf = async (type: string, id: string): Promise<string[]> => {
      const r = await post(owner, "/v1/access/shares_of", { resource: { type, id } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return (r.body.data.shares as { grant: { subject: { id: string } }; through: string }[]).map((x) => `${x.through}:${x.grant.subject.id}`);
    };
    assert.ok((await sharesOf("agent", agent.id)).includes(`owner:${first.id}`), "the agent resource is the named owner's from the start");
    assert.ok((await sharesOf("folder", agent.folderId)).includes(`manage:${first.id}`) || (await sharesOf("folder", agent.folderId)).some((w) => w.endsWith(`:${first.id}`)), "and so is the folder (a Manage share)");

    // moving ownership drops grants, so it is the server's alone: nobody reaches it over the gateway, whoever they are
    for (const token of [asker.token, owner]) {
      const direct = await post(token, "/v1/access/transfer_ownership", { resource: { type: "folder", id: agent.folderId }, from: first.id, to: asker.id });
      assert.notEqual(direct.status, 200, "a direct call to transfer_ownership is refused");
    }
    assert.ok((await sharesOf("folder", agent.folderId)).some((w) => w.endsWith(`:${first.id}`)), "and nothing moved");

    const promote = async (key: string, text: string): Promise<string> => {
      const fact = await post(asker.token, "/v1/memory/propose_fact", { idempotencyKey: `gf10-fact-${key}`, layer: "person", agentId: agent.id, text, sourceKind: "manual", sourceRef: `gf10-${key}` });
      assert.equal(fact.status, 200, JSON.stringify(fact.body));
      if (!fact.body.data.merged) assert.equal((await post(asker.token, "/v1/memory/fact/accept", { factId: fact.body.data.fact.factId })).status, 200);
      const p = await post(asker.token, "/v1/memory/promote", { idempotencyKey: `gf10-promote-${key}`, factId: fact.body.data.fact.factId, toLayer: "agent", agentId: agent.id });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      assert.equal(p.body.data.promoted, false, "the asker cannot edit the agent's memory, so a task waits for its owner");
      return p.body.data.promotionId as string;
    };
    const one = await promote("one", "Scout Two answers in plain language.");
    const approved = await post(first.token, "/v1/memory/promotion/approve", { promotionId: one });
    assert.equal(approved.status, 200, `the agent's owner approves: ${JSON.stringify(approved.body)}`);

    // the owner moves: the wizard reassigns the agent and the folder goes with it
    const removed = await post(owner, "/v1/members/remove", { personId: first.id, plan: [{ kind: "agents", action: "reassign", to: heir.id }] });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    for (const [type, id] of [["folder", agent.folderId], ["agent", agent.id]] as const) {
      const who = await sharesOf(type, id);
      assert.ok(who.includes(`owner:${heir.id}`), `the new owner owns the ${type}: ${who.join(", ")}`);
      assert.ok(!who.some((w) => w.endsWith(`:${first.id}`)), `and the previous owner holds nothing on the ${type}`);
    }

    const two = await promote("two", "Scout Two signs off with the date.");
    assert.equal((await post(heir.token, "/v1/memory/promotion/approve", { promotionId: two })).status, 200, "the new owner approves");
  } finally { await d.stop(); }
});
