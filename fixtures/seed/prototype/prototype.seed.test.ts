import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SPACE_KEYS, VYRE_SEED, expectedIds } from "./seed.ts";
import type { SeedIds } from "./seed.ts";
import { bootPrototype, idColumns } from "./build.ts";

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "proto-seed-cache-"));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "proto-seed-"));

const kinds = ["people", "agents", "clients", "companies"] as const;
const all = (ids: SeedIds): string[] => kinds.flatMap((k) => ids[k]);

test("the three seeds boot from a template and verify", async () => {
  assert.deepEqual([...SPACE_KEYS], ["northwind", "harbor", "personal"]);
  for (const key of SPACE_KEYS) {
    const first = await bootPrototype(key, { cache, scratch });
    assert.equal(first.hit, false, `${key}: first boot builds the template`);
    assert.equal(first.verified, true, `${key}: the log verifies`);
    assert.equal(first.space, VYRE_SEED[key].spaceId);
    first.close();
    const second = await bootPrototype(key, { cache, scratch });
    assert.equal(second.hit, true, `${key}: second boot copies the exported template`);
    second.close();
  }
});

test("every person, agent and client id of VyreSeed exists in its seeded Space, in order", async () => {
  for (const key of SPACE_KEYS) {
    const space = await bootPrototype(key, { cache, scratch });
    const want = expectedIds(key);
    for (const kind of kinds) assert.deepEqual(space[kind], want[kind], `${key} ${kind}`);
    console.log(`# ${key} ids, prototype vs seeded\n${idColumns(all(want), all(space))}`);
    space.close();
  }
});

test("the roster matches the prototype counts", () => {
  const count = (k: (typeof SPACE_KEYS)[number]): [number, number, number] => [VYRE_SEED[k].people.length, VYRE_SEED[k].clients.length, VYRE_SEED[k].agents.length];
  assert.deepEqual(count("northwind"), [6, 4, 5]);
  assert.deepEqual(count("harbor"), [3, 2, 3]);
  assert.deepEqual(count("personal"), [1, 0, 1]);
  assert.equal(VYRE_SEED.personal.kind, "personal");
  assert.equal(VYRE_SEED.northwind.kind, "team");
});

test("no id is duplicated inside a Space", async () => {
  for (const key of SPACE_KEYS) {
    const space = await bootPrototype(key, { cache, scratch });
    const ids = all(space);
    assert.equal(new Set(ids).size, ids.length, `${key}: duplicate id`);
    assert.equal(ids.length, all(expectedIds(key)).length);
    space.close();
  }
});

test("Personal has the owner and Assistant only, and no invites", async () => {
  const space = await bootPrototype("personal", { cache, scratch });
  assert.deepEqual(space.people, ["usr_irfad"]);
  assert.deepEqual(space.agents, ["agt_assistant"]);
  assert.equal(space.invited, 0);
  space.close();
});

test("Team Spaces invite and join everyone except the founding owner", async () => {
  for (const key of ["northwind", "harbor"] as const) {
    const space = await bootPrototype(key, { cache, scratch });
    assert.equal(space.invited, VYRE_SEED[key].people.length - 1, key);
    assert.equal(space.joined, VYRE_SEED[key].people.length - 1, key);
    space.close();
  }
});
