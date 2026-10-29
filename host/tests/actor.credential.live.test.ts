// An outside tool's redeemed credential grants exactly its roles and nothing more, through the real gateway on a booted daemon: a Member-role actor is refused an admin capability and a
// person-only capability, a token cannot be redeemed twice, and revoking the actor ends the credential.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

/** A fresh Space the owner claims and signs in to (ruling 71), the way a person gets in; the returned token is a real session. */
async function boot(): Promise<{ d: Daemon; owner: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-actor-cred-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_actor", "--space-name", "Forms Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "actor-cred", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (p: string, body: unknown, token?: string): Promise<{ status: number; json: { data?: any } }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as { data?: any } };   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  const claimed = await post("/v1/identity/claim_owner", { code, spaceId: "spc_actor", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post("/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  const owner = signedIn.json.data.session.token as string;
  return { d, owner };
}


const post = async <T>(d: Daemon, p: string, body: unknown, token: string | null): Promise<{ status: number; data?: T; error?: { code: string } }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, ...((await r.json()) as object) };
};

test("an outside actor's credential grants only the roles it was issued", async () => {
  const { d, owner } = await boot();
  try {
    const roles = (await post<{ roles: { id: string; name: string }[] }>(d, "/v1/access/roles/list", {}, owner)).data!.roles;
    const member = roles.find((r) => r.name === "Member")!.id;
    const made = await post<{ actor: { id: string }; oneTimeToken: string }>(d, "/v1/access/actors/create", { name: "Limited tool", provider: "anthropic", roleIds: [member], idempotencyKey: "cred-1" }, owner);
    assert.equal(made.status, 200, JSON.stringify(made));
    const redeemed = await post<{ credential: string }>(d, "/v1/access/actors/redeem", { token: made.data!.oneTimeToken }, null);
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed));
    const cred = redeemed.data!.credential;
    assert.ok((await post(d, "/v1/access/actors/redeem", { token: made.data!.oneTimeToken }, null)).status >= 400, "a token redeems once");
    // what its Member role allows
    let allowed = 0; for (let i = 0; i < 25 && allowed !== 200; i++) { allowed = (await post(d, "/v1/schema/types/list", {}, cred)).status; if (allowed !== 200) await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(allowed, 200, "the credential signs in as the actor, with its role");
    // what it must not do: an admin capability, a role it does not hold, and a person-only identity call
    for (const [cap, input] of [["access.actors.create", { name: "Escalation", provider: "x", idempotencyKey: "cred-esc" }], ["access.roles.assign", { subject: { kind: "actor", id: made.data!.actor.id }, roleId: roles.find((r) => r.name === "Admin")!.id }],
      ["members.invites.create", { role: member, idempotencyKey: "cred-inv" }], ["access.groups.create", { name: "Mine", idempotencyKey: "cred-grp" }], ["devices.list", {}], ["identity.whoami", {}]] as const) {
      const r = await post(d, `/v1/${cap.replaceAll(".", "/")}`, input, cred);
      assert.ok(r.status === 403 || r.status === 401, `${cap} is refused to the actor: ${r.status} ${JSON.stringify(r)}`);
    }
    // the role list is unchanged and no escalation actor exists
    const actors = (await post<{ actors: { name: string }[] }>(d, "/v1/access/actors/list", {}, owner)).data!.actors;
    assert.ok(!actors.some((a) => a.name === "Escalation"));
    // revoking ends it
    assert.equal((await post(d, "/v1/access/actors/revoke", { actorId: made.data!.actor.id }, owner)).status, 200);
    assert.equal((await post(d, "/v1/schema/types/list", {}, cred)).status, 401);
  } finally { await d.stop(); }
});

test("an outside actor with manage access cannot hand an agent to someone: the call is held for a person", async () => {
  const { d, owner } = await boot();
  try {
    const roles = (await post<{ roles: { id: string; name: string }[] }>(d, "/v1/access/roles/list", {}, owner)).data!.roles;
    const made = await post<{ actor: { id: string }; oneTimeToken: string }>(d, "/v1/access/actors/create", { name: "Admin tool", provider: "anthropic", roleIds: [roles.find((r) => r.name === "Admin")!.id], idempotencyKey: "gate-1" }, owner);
    const cred = (await post<{ credential: string }>(d, "/v1/access/actors/redeem", { token: made.data!.oneTimeToken }, null)).data!.credential;
    const agent = await post<{ agent: { agentId: string; ownerId: string } }>(d, "/v1/agents/create", { name: "Handoff", idempotencyKey: "gate-agent" }, owner);
    assert.equal(agent.status, 200, JSON.stringify(agent));
    const me = agent.data!.agent.ownerId;
    // the person owner may (given somebody active to hand it to)
    const invite = await post<{ link: string }>(d, "/v1/members/invites/create", { role: roles.find((r) => r.name === "Member")!.id, idempotencyKey: "gate-inv" }, owner);
    const code = decodeURIComponent(new URL(invite.data!.link).pathname.split("/").pop() ?? "");
    const joined = await post<{ personId: string }>(d, "/v1/members/accept", { code, username: "heir", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS }, null);
    const heir = joined.data!.personId;
    let held = 0, body: unknown = null;
    for (let i = 0; i < 25 && held === 0; i++) { const r = await post(d, "/v1/agents/set_owner", { agentId: agent.data!.agent.agentId, ownerId: heir }, cred); body = r; if (r.status !== 401) held = r.status || 1; else await new Promise((x) => setTimeout(x, 200)); }
    const after = await post<{ agent: { ownerId: string } }>(d, "/v1/agents/get", { agentId: agent.data!.agent.agentId }, owner);
    assert.equal(after.data!.agent.ownerId, me, `the actor's call did not move the agent: ${JSON.stringify(body)}`);
    const byPerson = await post<{ agent: { ownerId: string } }>(d, "/v1/agents/set_owner", { agentId: agent.data!.agent.agentId, ownerId: heir }, owner);
    assert.equal(byPerson.status, 200, JSON.stringify(byPerson));
    assert.equal(byPerson.data!.agent.ownerId, heir, "a person hands it over without a hold");
    const owned = (await post<{ owns: { type: string; id: string }[] }>(d, "/v1/access/principals/effective", { principal: { kind: "person", id: heir } }, owner)).data!.owns;
    assert.ok(owned.some((o) => o.type === "agent" && o.id === agent.data!.agent.agentId) && owned.some((o) => o.type === "folder"), `the heir owns the agent and its folder: ${JSON.stringify(owned)}`);
    const old = (await post<{ owns: { type: string; id: string }[] }>(d, "/v1/access/principals/effective", { principal: { kind: "person", id: me } }, owner)).data!.owns;
    assert.ok(!old.some((o) => o.id === agent.data!.agent.agentId), "the previous owner keeps nothing on the agent");
  } finally { await d.stop(); }
});
