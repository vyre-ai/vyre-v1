// The one-time pass that shares existing agents at the first start on the build that writes an agent's sharing with its birth, driven through the REAL start-up order on a carried data folder: a daemon is booted,
// agents are made (an owner's, an admin's, a plain member's, one an admin shared with one named person), the state of a folder from the build before is put back (the Everyone birth grants taken away, the marker
// removed), the daemon is stopped, and the same folder is booted again. The pass must read the folded access state: an owner's or admin's agent with no grant is shared, a plain member's is not, an agent with
// ANY grant is left exactly as it is, and a third boot writes nothing and never undoes a later unshare. (Run before the snapshot was built, the pass saw no grants and no one who may share with Everyone.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });
const PEOPLE = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana"];

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux",
      hostname: "birthshare",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const id = String(h["authorization"] ?? "").replace(/^Bearer /, "");
      return PEOPLE.includes(id) ? { space: "spc_core", principal: { kind: "person", id }, device: "mac" } : null;
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}
const as =
  (d: Daemon, who: string) =>
  async (cap: string, input: unknown): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
      body: JSON.stringify({ idempotencyKey: `bs-${cap}-${Math.random()}`, ...(input as object) }),
    });
    const body = (await r.json()) as { data?: unknown };
    assert.equal(r.status, 200, `${who} ${cap}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    return body.data;
  };
// the maker's own grant is how every agent is born: it is left out of what is compared
const shares = async (d: Daemon, agentId: string, owner: string): Promise<string[]> =>
  (
    (await as(d, "usr_olivia")("access.shares_of", { resource: { type: "agent", id: agentId } })).shares as Array<{
      grant: { subject: { kind: string; id: string }; resource?: { id?: string } };
    }>
  )
    .filter((s) => s.grant.resource?.id === agentId && s.grant.subject.id !== owner)
    .map((s) => `${s.grant.subject.kind}:${s.grant.subject.id}`)
    .sort();

test("the pass at the first start on this build reads the folded access state, writes once, and never undoes an unshare", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-birthshare-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const ids: Record<string, string> = {};
  let d = await boot(dir);
  try {
    const make = async (who: string, name: string, extra: object = {}): Promise<string> =>
      (await as(d, who)("agents.create", { name, role: "Help.", ...extra })).agent.agentId as string;
    ids["owner"] = await make("usr_olivia", "OwnerOld");
    ids["admin"] = await make("usr_adam", "AdminOld");
    ids["member"] = await make("usr_noah", "MemberOld");
    ids["named"] = await make("usr_olivia", "NamedOld", { sharing: "me" });
    await as(d, "usr_olivia")("access.share", {
      resource: { type: "agent", id: ids["named"] },
      subject: { kind: "person", id: "usr_mia" },
      level: "use",
    });
    // the folder as the build before left it: no birth grant on any agent, and the pass has not run
    for (const k of ["owner", "admin"])
      await as(d, "usr_olivia")("access.unshare", {
        resource: { type: "agent", id: ids[k]! },
        subject: { kind: "group", id: "grp_everyone" },
      });
    d.db!.run(`DELETE FROM host_passes WHERE "key" = 'agent-birth-share'`);
    assert.deepEqual(await shares(d, ids["owner"]!, "usr_olivia"), [], "the owner's old agent holds no grant");
    assert.deepEqual(
      await shares(d, ids["named"]!, "usr_olivia"),
      ["person:usr_mia"],
      "the named agent holds one grant",
    );
  } finally {
    await d.stop();
  }
  // first start on the new build
  d = await boot(dir);
  const after: Record<string, string[]> = {};
  try {
    const ownerOf: Record<string, string> = {
      owner: "usr_olivia",
      admin: "usr_adam",
      member: "usr_noah",
      named: "usr_olivia",
    };
    for (const k of Object.keys(ids)) after[k] = await shares(d, ids[k]!, ownerOf[k]!);
    assert.deepEqual(after["owner"], ["group:grp_everyone"], "an owner's old agent with no grant is shared");
    assert.deepEqual(after["admin"], ["group:grp_everyone"], "an admin's old agent with no grant is shared");
    assert.deepEqual(after["member"], [], "a plain member's old agent stays hers");
    assert.deepEqual(after["named"], ["person:usr_mia"], "an agent with any grant is left exactly as it is");
    // a later unshare
    await as(d, "usr_olivia")("access.unshare", {
      resource: { type: "agent", id: ids["owner"]! },
      subject: { kind: "group", id: "grp_everyone" },
    });
  } finally {
    await d.stop();
  }
  // second start: nothing written, the unshare stays
  d = await boot(dir);
  try {
    assert.deepEqual(await shares(d, ids["owner"]!, "usr_olivia"), [], "a later unshare is never undone");
    assert.deepEqual(await shares(d, ids["admin"]!, "usr_adam"), ["group:grp_everyone"]);
    assert.deepEqual(await shares(d, ids["member"]!, "usr_noah"), []);
    assert.deepEqual(await shares(d, ids["named"]!, "usr_olivia"), ["person:usr_mia"]);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
