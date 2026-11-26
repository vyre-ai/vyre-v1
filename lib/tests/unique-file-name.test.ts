// A new file's name is the first free one among what the caller can see, a few retries on a duplicate, then a random suffix; never a long loop.
import test from "node:test";
import assert from "node:assert/strict";
import { createUnique, firstFree, numbered } from "../unique-file-name.ts";

const dup = (): never => {
  throw Object.assign(new Error("That name is already in this folder."), { error: { code: "validation.duplicate" } });
};

test("numbering: the plain name, then (2) before the extension, then the first number nobody has", () => {
  assert.equal(numbered("a.csv", 1), "a.csv");
  assert.equal(numbered("a.csv", 3), "a (3).csv");
  assert.equal(numbered("README", 2), "README (2)");
  assert.equal(
    firstFree("a.csv", new Set(["a.csv", "a (2).csv", "a (4).csv"])),
    3,
    "the first gap, not the last number plus one",
  );
});

test("a folder full of numbered names costs one listing and one create; a name taken behind the caller's back is retried a few times, then gets a random suffix", async () => {
  let lists = 0;
  const taken = new Set<string>(["a.csv", ...Array.from({ length: 999 }, (_, i) => `a (${i + 2}).csv`)]);
  const made: string[] = [];
  const out = await createUnique(
    "a.csv",
    async () => {
      lists++;
      return taken;
    },
    async (name) => {
      if (taken.has(name)) return dup();
      taken.add(name);
      made.push(name);
      return name;
    },
  );
  assert.equal(lists, 1);
  assert.deepEqual(made, ["a (1001).csv"], "one create, with the first free number");
  assert.equal(out, "a (1001).csv");
  // names the caller cannot see: the listing misses them, so the creates fail until the suffix
  const hidden = new Set<string>(["b.csv", "b (2).csv", "b (3).csv", "b (4).csv", "b (5).csv", "b (6).csv"]);
  let tries = 0;
  const got = await createUnique(
    "b.csv",
    async () => [],
    async (name) => {
      tries++;
      if (hidden.has(name)) return dup();
      return name;
    },
    () => "x1y2z",
  );
  assert.equal(tries, 6, "five numbered tries and then one with the suffix, not a thousand");
  assert.equal(got, "b-x1y2z.csv");
  await assert.rejects(
    createUnique(
      "c.csv",
      async () => [],
      async () => {
        throw new Error("the disk is full");
      },
    ),
    /disk is full/,
    "an error that is not a duplicate is not retried",
  );
});
