// Every capability that takes access away is in force when it returns. A booted daemon over the core seed, the real access module and the real modules; for each way access is taken away the
// test first proves the person can do the thing, makes the call that takes it away, and on the very next request (no wait, no retry) proves they cannot. Session and device endings are walked on an
// open live socket in test/session-revoke.ws.live.test.ts; the race with the project's starting-roles consumer is held deterministically in modules/projects/tests/roles.race.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";

const PEOPLE = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana", "usr_tess"];
let n = 0;

interface Case {
  name: string;
  /** give the access; answers the check that holds while it is given */
  give(): Promise<() => Promise<boolean>>;
  /** the check is false before the access is given (the case proves its own give) */
  before?: () => Promise<boolean>;
  /** take it away */
  take(): Promise<void>;
}

test("each capability that takes access away answers only once the next request is refused", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-revoke-walk-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.0.0-test"),
    platform: fakePlatform({ os: "linux", hostname: "revoke-walk", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"apps":{"http":{}}}' }) as never,
    session: (headers) => { const id = String(headers.authorization ?? "").replace(/^Bearer /, ""); return PEOPLE.includes(id) ? { space: CORE_SPACE, principal: { kind: "person", id }, device: "revoke-walk" } : null; },
    intervals: { fast: 3600000, slow: 3600000, encryption: 3600000, commands: 3600000, hooks: 3600000 },
  });
  const call = async (cap: string, input: Record<string, unknown>, who: string): Promise<{ status: number; data?: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${daemon.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${who}`, "content-type": "application/json" }, body: JSON.stringify(input) });
    const b = (await r.json()) as { data?: unknown; error?: unknown };
    return { status: r.status, data: b.data ?? b.error };
  };
  const ok = async (cap: string, input: Record<string, unknown>, who: string): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await call(cap, { idempotencyKey: `rw-${++n}`, ...input }, who);
    assert.equal(r.status, 200, `${cap} as ${who}: ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const mine = async (who: string, resource: { type: string; id: string }): Promise<string | undefined> => {
    const r = await call("access.shares_of", { resource }, who);
    return r.status === 200 ? ((r.data as { mine?: string }).mine ?? "view") : undefined;
  };
  const person = (id: string) => ({ kind: "person", id });

  try {
    // Olivia's own project: its folder is open to her alone until she shares it
    const project = await ok("projects.create", { type: "project", title: "Revoke walk" }, "usr_olivia");
    const projectId = project.projectId as string;
    const folder = { type: "folder", id: project.folderId as string };
    const record = (await ok("records.create", { type: "contact", fields: { name: "Walk contact" } }, "usr_olivia")).record as { id?: string; recordId?: string };
    const recordRef = { type: "record", id: (record.recordId ?? record.id)! };
    await ok("access.audience_set", { resource: recordRef, audience: "added" }, "usr_olivia");
    // Noah's own agent
    const agentId = ((await ok("agents.create", { name: "Walk helper", computer: false }, "usr_noah")).agent as { agentId: string }).agentId;
    const agent = { type: "agent", id: agentId };
    const folderOpens = (who: string) => async () => (await call("files.folder.get", { folderId: folder.id }, who)).status === 200;

    const cases: Case[] = [
      {
        name: "share revoke on a folder (access.unshare)",
        before: async () => (await mine("usr_sana", folder)) === "edit",
        give: async () => { await ok("access.share", { resource: folder, subject: person("usr_sana"), level: "edit" }, "usr_olivia"); return async () => (await mine("usr_sana", folder)) === "edit"; },
        take: async () => { await ok("access.unshare", { resource: folder, subject: person("usr_sana") }, "usr_olivia"); },
      },
      {
        name: "share lowered on a folder, Edit to View (access.grants.update)",
        give: async () => {
          await ok("access.share", { resource: folder, subject: person("usr_sana"), level: "edit" }, "usr_olivia");
          return async () => (await mine("usr_sana", folder)) === "edit";
        },
        take: async () => {
          const g = ((await ok("access.grants.list", { resource: folder }, "usr_olivia")).grants as Array<{ id: string; subject: { id: string } }>).find((x) => x.subject.id === "usr_sana")!;
          await ok("access.grants.update", { grantId: g.id, level: "view" }, "usr_olivia");
        },
      },
      {
        name: "share revoke on a record (access.unshare)",
        give: async () => { await ok("access.share", { resource: recordRef, subject: person("usr_noah"), level: "view" }, "usr_olivia"); return async () => (await call("records.get", { type: "contact", recordId: recordRef.id }, "usr_noah")).status === 200; },
        take: async () => { await ok("access.unshare", { resource: recordRef, subject: person("usr_noah") }, "usr_olivia"); },
      },
      {
        name: "project member removed (projects.members.remove)",
        give: async () => { await ok("projects.members.set", { projectId, principal: "usr_tess", role: "member" }, "usr_olivia"); return async () => (await mine("usr_tess", { type: "project", id: projectId })) !== undefined; },
        take: async () => { await ok("projects.members.remove", { projectId, principal: "usr_tess" }, "usr_olivia"); },
      },
      {
        name: "project role lowered, Lead to Guest (projects.members.set)",
        give: async () => { await ok("projects.members.set", { projectId, principal: "usr_mia", role: "lead" }, "usr_olivia"); return async () => (await mine("usr_mia", { type: "project", id: projectId })) === "manage"; },
        take: async () => { await ok("projects.members.set", { projectId, principal: "usr_mia", role: "guest" }, "usr_olivia"); },
      },
      {
        name: "group member removed (access.groups.remove_member)",
        before: async () => (await mine("usr_noah", folder)) === "edit",
        give: async () => { await ok("access.share", { resource: folder, subject: { kind: "group", id: "grp_leads" }, level: "edit" }, "usr_olivia"); return async () => (await mine("usr_noah", folder)) === "edit"; },
        take: async () => { await ok("access.groups.remove_member", { groupId: "grp_leads", member: person("usr_noah") }, "usr_olivia"); },
      },
      {
        name: "role taken away (access.roles.unassign)",
        give: async () => { await ok("access.roles.assign", { subject: person("usr_sana"), roleId: "rol_admin" }, "usr_olivia"); return async () => (await call("members.invites.list", {}, "usr_sana")).status === 200; },
        take: async () => { await ok("access.roles.unassign", { subject: person("usr_sana"), roleId: "rol_admin" }, "usr_olivia"); },
      },
      {
        name: "permission taken away by an exception (access.exceptions.set, deny)",
        give: async () => async () => (await call("members.invites.list", {}, "usr_adam")).status === 200,
        take: async () => { await ok("access.exceptions.set", { subject: person("usr_adam"), effect: "deny", perms: ["members.invite"], why: "walk" }, "usr_olivia"); },
      },
      {
        name: "agent access revoke (access.unshare on an agent)",
        give: async () => { await ok("access.share", { resource: agent, subject: person("usr_tess"), level: "use" }, "usr_noah"); return async () => (await mine("usr_tess", agent)) === "use"; },
        take: async () => { await ok("access.unshare", { resource: agent, subject: person("usr_tess") }, "usr_noah"); },
      },
      {
        name: "agent handed to someone else (agents.set_owner)",
        give: async () => async () => (await mine("usr_noah", agent)) === "manage",
        take: async () => { await ok("agents.set_owner", { agentId, ownerId: "usr_sana" }, "usr_noah"); },
      },
      {
        name: "Space member suspended (members.suspend)",
        before: folderOpens("usr_tess"),
        give: async () => { await ok("access.share", { resource: folder, subject: person("usr_tess"), level: "view" }, "usr_olivia"); return folderOpens("usr_tess"); },
        take: async () => { await ok("members.suspend", { personId: "usr_tess" }, "usr_olivia"); },
      },
      {
        name: "Space member removed (members.remove)",
        before: async () => (await mine("usr_noah", folder)) === "manage",
        give: async () => { await ok("access.share", { resource: folder, subject: person("usr_noah"), level: "manage" }, "usr_olivia"); return async () => (await mine("usr_noah", folder)) === "manage"; },
        take: async () => { await ok("members.remove", { personId: "usr_noah", plan: [] }, "usr_olivia"); },
      },
      {
        name: "Space ownership transferred (spaces.transfer_ownership)",
        give: async () => async () => (await mine("usr_olivia", { type: "space", id: CORE_SPACE })) === "manage" && (await call("access.shares_of", { resource: { type: "space", id: CORE_SPACE } }, "usr_olivia")).data?.shares?.some((s: { through: string; grant: { subject: { id: string } } }) => s.through === "owner" && s.grant.subject.id === "usr_olivia") === true,
        take: async () => { await ok("spaces.transfer_ownership", { to: "usr_adam" }, "usr_olivia"); },
      },
    ];

    const results: string[] = [];
    for (const c of cases) {
      if (c.before) assert.equal(await c.before(), false, `${c.name}: the check does not hold before the access is given`);
      const holds = await c.give();
      assert.equal(await holds(), true, `${c.name}: the access is there before`);
      await c.take();
      const still = await holds();   // the very next request, no wait
      results.push(`${still ? "STILL" : "gone "} ${c.name}`);
    }
    assert.deepEqual(results.filter((r) => r.startsWith("STILL")), [], results.join("\n"));
  } finally {
    await daemon.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
