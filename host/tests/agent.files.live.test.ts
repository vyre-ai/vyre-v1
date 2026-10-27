// P-L5_30: an agent's AGENT.md and agent.toml are never lost, on a booted daemon. The owner makes an agent through the gateway; deleting, moving or renaming either file is refused with a plain
// reason; a file lost underneath Files is put back by the boot check when the daemon starts again.
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

function bootOn(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_agentfiles", "--space-name", "Agent Files Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "agent-files", free: 80e9,
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

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string; details?: Record<string, unknown> } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

/** Claims a fresh Space as its owner and signs in (ruling 71). */
async function owner(d: Daemon): Promise<string> {
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  const claimed = await post(d, "/v1/identity/claim_owner", { code, spaceId: "spc_agentfiles", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  return signedIn.json.data.session.token as string;
}

test("an agent's AGENT.md and agent.toml cannot be deleted, moved or renamed through files.*, and a file lost underneath is put back at the next start", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-agent-files-"));
  let d = await bootOn(dir);
  try {
    const token = await owner(d);
    const made = await post(d, "/v1/agents/create", { name: "Scout", role: "Use me when a new client form arrives.", idempotencyKey: "agent-files-scout" }, token);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const row = (): { folderId: string; tomlFileId: string; agentMdFileId: string } => d.db!.all("SELECT folderId, tomlFileId, agentMdFileId FROM agents_agent WHERE name = 'Scout'")[0] as never;
    const { folderId, tomlFileId, agentMdFileId } = row();
    assert.ok(folderId && tomlFileId && agentMdFileId, "the record names the folder and both files");
    const live = (id: string): { name: string; folder_id: string; deleted_at: number | null } => d.db!.all("SELECT name, folder_id, deleted_at FROM files_file WHERE id = ?", id)[0] as never;
    for (const id of [tomlFileId, agentMdFileId]) {
      const del = await post(d, "/v1/files/delete", { fileId: id }, token);
      assert.equal(del.status, 422, JSON.stringify(del.json));
      assert.equal(del.json.error?.code, "validation.precondition_failed");
      assert.match(del.json.error?.message ?? "", /is part of the agent, so it cannot be deleted\. Edit it, or delete the agent/);
      assert.equal((await post(d, "/v1/files/rename", { fileId: id, name: "gone.txt" }, token)).status, 422);
      assert.equal(live(id).deleted_at, null, "nothing changed");
    }

    // ruling 99: an agent must act for its owner at the invocation boundary; a raw access.check for the agent alone is refused.
    const agentId = d.db!.all("SELECT id FROM agents_agent WHERE name = 'Scout'")[0] as unknown as { id: string };
    const ownerId = (d.db!.all("SELECT ownerId FROM agents_agent WHERE id = ?", agentId.id)[0] as unknown as { ownerId: string }).ownerId;
    const other = await post(d, "/v1/agents/create", { name: "Other", role: "Another agent.", idempotencyKey: "agent-files-other" }, token);
    assert.equal(other.status, 200, JSON.stringify(other.json));
    const otherId = (d.db!.all("SELECT id FROM agents_agent WHERE name = 'Other'")[0] as unknown as { id: string }).id;
    // Remove Other's broader Space grant so this assertion isolates the two agents' home grants.
    const narrowed = await post(d, "/v1/access/unshare", { resource: { type: "space", id: "spc_agentfiles" }, subject: { kind: "agent", id: otherId } }, token);
    assert.equal(narrowed.status, 200, JSON.stringify(narrowed.json));
    const check = async (kind: string, id: string, level: string, actingFor?: string): Promise<{ effect: string; reason?: string }> => {
      // files.folder.get has no role permission: reach is decided by the folder grant and, for an agent, its acting person.
      const r = await post(d, "/v1/access/check", { principal: { kind, id }, ...(actingFor ? { actingFor: { kind: "person", id: actingFor } } : {}), action: { level }, resource: { type: "folder", id: folderId } }, token);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json.data.decision;
    };
    const raw = await check("agent", agentId.id, "view");
    assert.equal(raw.effect, "deny", "an agent without actingFor cannot access a home");
    assert.equal(raw.reason, "agent_needs_actor");
    assert.equal((await check("agent", agentId.id, "view", ownerId)).effect, "allow", "the agent lists its own home for its owner");
    assert.equal((await check("agent", agentId.id, "edit", ownerId)).effect, "allow", "and edits it");
    assert.equal((await check("agent", agentId.id, "manage", ownerId)).effect, "deny", "but cannot share it out");
    assert.equal((await check("agent", otherId, "view", ownerId)).effect, "deny", "another agent's home grant does not reach this folder");

    // a file lost underneath Files (a restore from an old backup, a hand edit of the database): the next start puts it back from the record
    d.db!.run("UPDATE files_file SET deleted_at = ? WHERE id = ?", Date.now(), agentMdFileId);
    d.db!.run("DELETE FROM files_file WHERE id = ?", tomlFileId);
    await d.stop();
    d = await bootOn(dir);
    const deadline = Date.now() + 8000;
    let back = false;
    while (Date.now() < deadline && !back) {
      const r = row();
      back = live(agentMdFileId)?.deleted_at === null && d.db!.all("SELECT id FROM files_file WHERE id = ? AND folder_id = ? AND name = 'agent.toml' AND deleted_at IS NULL", r.tomlFileId, folderId).length === 1;
      if (!back) await new Promise((res) => setTimeout(res, 200));
    }
    assert.ok(back, "AGENT.md is out of Trash and agent.toml is made again, both in Agents/Scout");
    assert.notEqual(row().tomlFileId, tomlFileId, "the record points at the new agent.toml");
  } finally { await d.stop(); }
});
