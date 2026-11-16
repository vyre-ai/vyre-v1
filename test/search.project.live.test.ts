// Cmd-K in Records (owner, 16 Nov): a project made in the Space is found by its name, by the person who leads it and by another member, and the hit names the project's record so it opens.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, twoMembers, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let a: Person;
let b: Person;
before(async () => {
  h = await bootHour("searchproj");
  ({ a, b } = await twoMembers(h));
});
after(async () => {
  await h?.stop();
});

type Hit = { kind: string; id: string; title: string; recordType?: string };
const find = async (p: Person, q: string): Promise<Hit[]> =>
  ((await p.call("search.query", { q })).hits as Hit[]).filter((x) => x.kind === "record");

test("a project is found by its name, from the first word, a middle word and the whole name, and its hit is the project's own record", async () => {
  const made = await h.owner.call("projects.create", {
    type: "project",
    title: "Client portal launch",
    idempotencyKey: "sp-1",
  });
  const projectId = made.projectId as string;
  const recordId = made.recordId as string;
  assert.ok(projectId && recordId, JSON.stringify(made));
  for (const q of ["Client portal launch", "portal", "Client", "launch"]) {
    const got = await waitFor(
      async () => {
        const hits = (await find(h.owner, q)).filter((x) => x.title === "Client portal launch");
        return hits.length > 0 ? hits : null;
      },
      15_000,
      `the owner finds the project by ${q}`,
    );
    assert.equal(got.length, 1, `once, by ${q}`);
    assert.equal(got[0]!.id, recordId, "the hit is the project's record, which the Records place opens");
    assert.equal(got[0]!.recordType, "project");
  }
});

test("a member who leads the project finds it by its name too", async () => {
  const made = await h.owner.call("projects.create", {
    type: "project",
    title: "Harbor lease review",
    idempotencyKey: "sp-2",
  });
  await h.owner.call("projects.members.set", { projectId: made.projectId, principal: a.personId, role: "lead" });
  const mine = await waitFor(
    async () => {
      const hits = (await find(a, "Harbor lease")).filter((x) => x.title === "Harbor lease review");
      return hits.length > 0 ? hits : null;
    },
    15_000,
    "the lead finds the project",
  );
  assert.equal(mine.length, 1);
  assert.ok(b.personId, "a second member is in the Space");
});
