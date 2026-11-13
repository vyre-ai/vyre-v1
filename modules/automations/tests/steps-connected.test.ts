// The step picker lists an app's actions only when the app is connected on the Space and the person may use it (owner, 13 Nov 2026: "it should only show me the things that I have in vault and have access to",
// after Microsoft steps showed on a Space that never set up Microsoft). "May use" is the product's own check for a connection: connections.list shows a person the Space's connections and their own, and
// nobody else's. The Assistant reads the same list (automations_steps_list), so it proposes only what is listed.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { admin, alice } from "../fixtures/seed.ts";

type Row = { connector: string; state: string };
interface World {
  /** What connections.list answers each person (the product's own check: who may see which connection). */
  connections: Record<string, Row[]>;
  githubMe?: boolean;
  installations?: number;
  failing?: boolean;
}
function world(w: World): Harness {
  const h = harness({ authorize: () => false });
  h.callee("steps.support", () => ({ code: { available: true }, ai: { available: true } }));
  h.callee("connections.list", (_i, who) => {
    if (w.failing) throw new Error("no");
    return { connections: w.connections[who.id] ?? [] };
  });
  h.callee("github.me.status", () => {
    if (w.failing) throw new Error("no");
    return { connected: w.githubMe === true, needsReconnect: false };
  });
  h.callee("github.installations.list", () => {
    if (w.failing) throw new Error("no");
    return { installations: Array.from({ length: w.installations ?? 0 }, (_, i) => ({ id: i + 1 })) };
  });
  return h;
}
const keysOf = async (h: Harness, who = alice): Promise<string[]> =>
  ((await h.call("automations.steps.list", {}, who)).steps as { key: string }[]).map((s) => s.key);
const has = (keys: string[], start: string): boolean => keys.some((k) => k.startsWith(start));

test("a Space with only Google connected lists Google's actions and none of Microsoft's or GitHub's", async () => {
  const keys = await keysOf(world({ connections: { usr_alice: [{ connector: "google", state: "active" }] } }));
  assert.equal(has(keys, "google."), true);
  assert.equal(has(keys, "ms."), false, "Microsoft was never set up here");
  assert.equal(has(keys, "github."), false, "GitHub was never set up here");
  for (const own of ["send_email", "http_request", "sheet.add_rows", "files.create", "records.find", "paths"])
    assert.equal(keys.includes(own), true, `${own} is Vyre's own and stays`);
});

test("a person who may not use the Google connection sees none of its actions; an admin who connected it sees them", async () => {
  const h = world({ connections: { usr_admin: [{ connector: "google", state: "active" }] } });
  assert.equal(has(await keysOf(h, alice), "google."), false);
  assert.equal(has(await keysOf(h, admin), "google."), true);
});

test("an app whose connection is still waiting to be finished is not connected", async () => {
  const keys = await keysOf(world({ connections: { usr_alice: [{ connector: "microsoft", state: "pending" }] } }));
  assert.equal(has(keys, "ms."), false);
});

test("Microsoft and GitHub are listed once they are connected", async () => {
  const keys = await keysOf(
    world({ connections: { usr_alice: [{ connector: "microsoft", state: "active" }] }, githubMe: true }),
  );
  assert.equal(has(keys, "ms."), true);
  assert.equal(has(keys, "github."), true);
  assert.equal(has(keys, "google."), false);
  const space = await keysOf(world({ connections: {}, installations: 1 }));
  assert.equal(has(space, "github."), true, "the Space's GitHub app, for a person who may read it");
});

test("a check that cannot be made lists no app: nothing is shown that could not be used", async () => {
  const keys = await keysOf(
    world({ connections: { usr_alice: [{ connector: "google", state: "active" }] }, failing: true }),
  );
  assert.equal(has(keys, "google.") || has(keys, "ms.") || has(keys, "github."), false);
});

test("the Assistant's list is this one: the same capability, asked as its person, so it never proposes a step the picker does not show", async () => {
  const h = world({ connections: { usr_alice: [{ connector: "google", state: "active" }] } });
  const picker = await keysOf(h, alice);
  const assistant = (
    (await h.call("automations.steps.list", { category: "send" }, alice)).steps as { key: string }[]
  ).map((s) => s.key);
  assert.equal(
    assistant.every((k) => picker.includes(k)),
    true,
  );
  assert.equal(has(assistant, "ms."), false);
});
