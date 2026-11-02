// Live bug (rc.14 team Space): the agents' boot check ("agents.agent_files", every 15 s) wrote the grants on each agent's home folder as the host itself, which holds no grant there, so
// access.shares_of and access.share were refused for every assistant made when a person joined, and the job logged the failure again on every pass. A person's assistant gets its home grants
// when it is made, under that person's authority, and the boot check then has nothing to do: it is quiet.
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
const SPACE = "spc_homegrants";

function bootOn(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", SPACE, "--space-name", "Home Grants Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "home-grants", free: 80e9,
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

/** Warnings and refusals the server logged since `after` (a log row id). */
function noise(d: Daemon, after: number): string[] {
  d.sink.flush();
  const db = new DatabaseSync(d.paths.logs, { readOnly: true });
  try {
    const rows = db.prepare("SELECT id, level, place, cap, msg, attrs FROM logs WHERE id > ? AND level >= 30 ORDER BY id").all(after) as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
    return rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 240)}`);
  } finally { db.close(); }
}
function lastLogId(d: Daemon): number {
  d.sink.flush();
  const db = new DatabaseSync(d.paths.logs, { readOnly: true });
  try { return Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM logs").get() as { n: number }).n); } finally { db.close(); }
}

test("assistants made when people join hold their home grants from the start, and the 15 s boot check is quiet when there is nothing to do", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-home-grants-"));
  const d = await bootOn(dir);
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    const claimed = await post(d, "/v1/identity/claim_owner", { code, spaceId: SPACE, username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
    const token = (await post(d, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device })).json.data.session.token as string;
    const invite = await post(d, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "home-grants-invite" }, token);
    assert.equal(invite.status, 200, JSON.stringify(invite.json));
    const inviteCode = decodeURIComponent(new URL(invite.json.data.link as string).pathname.split("/").pop() ?? "");
    const joined = await post(d, "/v1/members/accept", { code: inviteCode, username: "ruby", password: PASSWORD, deviceName: "Browser", deviceClass: "desktop", keys: KEYS });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    const ruby = joined.json.data.personId as string;
    const rubyToken = joined.json.data.token as string;
    // an agent the owner makes from the app as well
    assert.equal((await post(d, "/v1/agents/create", { name: "Scout", idempotencyKey: "home-grants-scout" }, token)).status, 200);
    // and one the member makes for themselves: its home is theirs, not the Space owner's
    const rubyMade = await post(d, "/v1/agents/create", { name: "Ruby Helper", idempotencyKey: "home-grants-ruby" }, rubyToken);
    assert.equal(rubyMade.status, 200, JSON.stringify(rubyMade.json));

    // the consumers have made both assistants
    await d.hooks!.pump();
    const agents = (): Array<{ id: string; ownerId: string; folderId: string; kind: string }> => d.db!.all("SELECT id, ownerId, folderId, kind FROM agents_agent WHERE deletedAt IS NULL") as never;
    const end = Date.now() + 10_000;
    while (agents().filter((a) => a.kind === "assistant").length < 2 && Date.now() < end) { await d.hooks!.pump(); await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(agents().filter((a) => a.kind === "assistant").length, 2, "each person has an assistant");

    // the first passes may write what a home still lacks; after that the check is quiet
    await d.hooks!.runPeriodic("agents.agent_files");
    const mark = lastLogId(d);
    await d.hooks!.runPeriodic("agents.agent_files");
    await d.hooks!.runPeriodic("agents.agent_files");
    assert.deepEqual(noise(d, mark).filter((l) => /agents|access\.|hooks/.test(l)), [], "a pass with nothing to do logs nothing");

    // and the grants are there: each agent edits its home for its owner, and the owner manages it
    for (const a of agents()) {
      const check = async (kind: string, id: string, level: string, actingFor?: string): Promise<string> => {
        const r = await post(d, "/v1/access/check", { principal: { kind, id }, ...(actingFor ? { actingFor: { kind: "person", id: actingFor } } : {}), action: { level }, resource: { type: "folder", id: a.folderId } }, token);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        return r.json.data.decision.effect as string;
      };
      assert.equal(await check("agent", a.id, "edit", a.ownerId), "allow", `${a.kind} ${a.id} edits its home for its owner`);
      assert.equal(await check("person", a.ownerId, "manage"), "allow", `the owner of ${a.kind} ${a.id} manages its home`);
    }
    assert.equal(agents().filter((a) => a.ownerId === ruby).length, 2, "the member owns their assistant and the agent they made");
  } finally { await d.stop(); }
});
