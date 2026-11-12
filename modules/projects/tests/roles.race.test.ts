// Taking a project role away is in force when the call returns, even while the `project.created` consumer (projects.initial_roles) is still running for the same project. The consumer reads the
// members and then writes one grant per member; a remove or a role change made between its read and its writes used to be undone by those writes (CI run 7 of PR 907: a removed member read 'edit').
// Each test holds the consumer's first write deterministically, makes the change while it is held, then lets it finish.
import test from "node:test";
import assert from "node:assert/strict";
import { DANA, LEO, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { key, run } from "../fixtures/seed.ts";
import { grantOnProject } from "../impl.ts";

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Hold the next access.share the consumer makes on the project itself until `release` is called. */
function holdProjectShare(h: Harness, projectId: string): { held: Promise<void>; release: () => void } {
  const real = h.world.handlers["access.share"]!;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const held = new Promise<void>((r) => { reached = r; });
  let once = false;
  h.world.handlers["access.share"] = async (i, o) => {
    if (!once && i.resource?.type === "project" && i.resource.id === projectId) { once = true; reached(); await gate; }
    return real(i, o);
  };
  return { held, release };
}

const onProject = (h: Harness, projectId: string, who: string): string[] =>
  h.world.grants.filter((g) => g.subject.id === who && g.resource.type === "project" && g.resource.id === projectId).map((g) => g.level).sort();

for (const change of ["remove", "role down"] as const) {
  test(`a ${change} made while the project's starting-roles consumer is mid-way is not undone by it`, async () => {
    const h = harness();
    const made = await run(h, "projects.create", { type: "project", title: "Race", idempotencyKey: key() });
    await run(h, "projects.members.set", { projectId: made.projectId, principal: LEO, role: change === "remove" ? "member" : "lead" });
    assert.deepEqual(onProject(h, made.projectId, LEO), [change === "remove" ? "edit" : "manage"], "the role landed on the project");
    // the consumer for project.created is delivered late (a hook backlog): it reads the members, Leo among them, and its first write is held
    const hold = holdProjectShare(h, made.projectId);
    const late = grantOnProject(h.ctx, made.projectId);
    await hold.held;
    const changed = change === "remove"
      ? run(h, "projects.members.remove", { projectId: made.projectId, principal: LEO })
      : run(h, "projects.members.set", { projectId: made.projectId, principal: LEO, role: "guest" });
    await tick();   // every fake answers in a microtask: the change has finished, or it is waiting for the consumer
    hold.release();
    await Promise.all([late, changed]);
    if (change === "remove") {
      assert.deepEqual(onProject(h, made.projectId, LEO), [], "the removed member holds nothing on the project");
      assert.equal(h.rows("SELECT * FROM projects_member WHERE projectId = ? AND principal = ?", made.projectId, LEO).length, 0);
    } else {
      assert.deepEqual(onProject(h, made.projectId, LEO), ["view"], "after the change to Guest, Leo holds View and nothing more");
    }
    assert.deepEqual(onProject(h, made.projectId, DANA), ["manage"], "the maker still leads");
  });
}
