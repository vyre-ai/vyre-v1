// Giving a task to a guest says what they will see before it is saved.
import test from "node:test";
import assert from "node:assert/strict";
import { directoryOf } from "../../../shell/session/private-agents.ts";
import { seatsFrom } from "./people.ts";
import { giveWithCare, guestNote } from "./guest.ts";

test("a person who holds only the Guest role is marked a guest, and the seat keeps the mark", () => {
  const dir = directoryOf([
    { id: "usr_me", name: "Me", kind: "person", roles: ["rol_owner"] },
    { id: "usr_g", name: "Gus Guest", kind: "person", roles: ["rol_guest"] },
    { id: "usr_m", name: "Mia", kind: "person", roles: ["rol_member"] },
  ], { id: "agt_a", name: "Assistant" }, "usr_me", null);
  assert.deepEqual(dir.map((p) => p.guest === true), [false, true, false]);
  const seats = seatsFrom(dir, [], "usr_me");
  assert.equal(seats.find((s) => s.id === "usr_g")?.guest, true);
  assert.equal(seats.find((s) => s.id === "usr_m")?.guest, undefined);
});

test("a guest is asked about first and named what they will see; anyone else is given the task at once", () => {
  let given = 0;
  const shown: unknown[][] = [];
  const show = ((items: unknown[]) => { shown.push(items); }) as never;
  giveWithCare(show, { name: "Mia" }, { x: 1, y: 2 }, () => { given += 1; });
  assert.equal(given, 1);
  assert.equal(shown.length, 0);
  giveWithCare(show, { name: "Gus", guest: true }, { x: 1, y: 2 }, () => { given += 1; });
  assert.equal(given, 1, "nothing is saved until they agree");
  const items = shown[0] as Array<{ head?: string; label?: string; onSelect?(): void }>;
  assert.match(items[0]!.head!, /the task, its thread and its files/);
  assert.equal(items[0]!.head, guestNote("Gus"));
  items.find((i) => i.label === "Give it to Gus")!.onSelect!();
  assert.equal(given, 2);
});
