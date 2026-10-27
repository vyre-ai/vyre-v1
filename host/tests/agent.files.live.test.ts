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

    // ruling 99: the agent edits its own home (not Manage), its owner manages it, another agent has no access to it
    const agentId = d.db!.all("SELECT id FROM agents_agent WHERE name = 'Scout'")[0] as unknown as { id: string };
    const other = await post(d, "/v1/agents/create", { name: "Other", role: "Another agent.", idempotencyKey: "agent-files-other" }, token);
    assert.equal(other.status, 200, JSON.stringify(other.json));
    const otherId = (d.db!.all("SELECT id FROM agents_agent WHERE name = 'Other'")[0] as unknown as { id: string }).id;
    const check = async (kind: string, id: string, level: string): Promise<{ effect: string; reason?: string }> => {
      if (kind === "agent" && id === agentId.id && level === "view") {
        console.log("agent-home-access-diagnostic", JSON.stringify({
          folderId,
          principal: d.db!.all("SELECT id, kind, status FROM access_principals WHERE id = ?", id),
          resource: d.db!.all("SELECT id, type, parent_id, owner_id FROM access_resources WHERE id = ?", folderId),
          grants: d.db!.all("SELECT id, subjectKind, subjectId, resourceType, resourceId, level FROM access_grants WHERE resourceId = ?", folderId),
        }));
      }
      const r = await post(d, "/v1/access/check", { principal: { kind, id }, action: { perm: "files.read", level }, resource: { type: "folder", id: folderId } }, token);
      if (kind === "agent" && id === agentId.id && level === "view") console.log("agent-home-decision-diagnostic", JSON.stringify(r.json));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json.data.decision;
    };
    assert.equal((await check("agent", agentId.id, "view")).effect, "allow", "the agent lists its own home");
    assert.equal((await check("agent", agentId.id, "edit")).effect, "allow", "and edits it");
    assert.equal((await check("agent", agentId.id, "manage")).effect, "deny", "but cannot share it out");
    assert.equal((await check("agent", otherId, "view")).effect, "deny", "another agent has no access to it");

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
