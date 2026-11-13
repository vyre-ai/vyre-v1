// A join step retried later never gives back a role an admin gave and took back after the step failed: the retry reads the audit log at that moment (no consumer in between), so the role is held
// back and shown to admins as needing them. A step nobody touched is still given. A booted daemon, the real members, access and audit modules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, seededDir } from "./memory-live-kit.ts";
import { join, ok, standIn } from "./member-key-kit.ts";

test("a role given and taken back after a join step failed is not given by the retry; an untouched step is", async () => {
  const dir = seededDir();
  const d = await boot(dir, standIn);
  try {
    const roles = (await ok(d, d.token, "access.roles.list")).roles as { id: string; name: string }[];
    const admin = roles.find((r) => r.name === "Admin")!.id;
    const ana = await join(d, "ana");
    const ben = await join(d, "ben");
    const failedAt = Date.now() - 60_000;
    const failStep = (person: string) =>
      d.db!.run(
        "UPDATE members_joins SET steps = ?, state = ? WHERE person_id = ?",
        JSON.stringify([
          { k: `role:${admin}`, state: "failed", tries: 1, error: "internal.unavailable", seen: "false", failedAt },
        ]),
        "pending",
        person,
      );
    failStep(ana.personId);
    failStep(ben.personId);
    // after Ana's step failed, an admin gave her the role and took it back
    await ok(d, d.token, "access.roles.assign", { subject: { kind: "person", id: ana.personId }, roleId: admin });
    await ok(d, d.token, "access.roles.unassign", { subject: { kind: "person", id: ana.personId }, roleId: admin });
    const rolesOf = async (id: string) =>
      (
        (await ok(d, d.token, "access.principals.get", { principal: { kind: "person", id } })).principal as {
          roles: string[];
        }
      ).roles;
    await ok(d, d.token, "members.joins.retry", { personId: ana.personId });
    assert.equal((await rolesOf(ana.personId)).includes(admin), false, "the admin's change stands");
    const listed = (await ok(d, d.token, "members.joins.list", {})).joins as Array<{
      personId: string;
      steps: Array<{ key: string; error: string }>;
    }>;
    assert.match(
      listed.find((j) => j.personId === ana.personId)?.steps.find((s) => s.key === `role:${admin}`)?.error ?? "",
      /changed this after they joined/,
      "shown to admins as needing them",
    );
    await ok(d, d.token, "members.joins.retry", { personId: ben.personId });
    assert.equal((await rolesOf(ben.personId)).includes(admin), true, "nobody touched Ben's: the retry gives it");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
