// @tsx
// Hover and focus warming fetches only from the allow-list of pure reads (warm-caps.ts); a write, an outward call, a read that does work, or a name nobody listed is never fetched speculatively.
import test from "node:test";
import assert from "node:assert/strict";
import { WARM_READS, mayWarm } from "./warm-caps.ts";
import { routes } from "../../../../../generated/routes.ts";
import { createRemoteScreenHooks } from "./remote-hooks.ts";

const micro = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const effects = new Map(routes.map((r) => [r.cap, r.effects]));

test("every name on the allow-list is a read in the generated routes", () => {
  for (const cap of WARM_READS) assert.equal(effects.get(cap), "read", `${cap} must be a read`);
});

test("nothing that writes, goes outward or does work is on the allow-list", () => {
  for (const [cap, e] of effects) if (e !== "read") assert.equal(mayWarm(cap), false, cap);
  for (const cap of [
    "chat.thread",
    "goals.complete",
    "projects.archive",
    "connections.test",
    "engine.probe_account",
    "automations.try_read",
    "chat.ask_suggest",
    "records.export",
    "engine.use_policy.export",
    "vault.items.list",
    "identity.keys_get",
    "members.list",
    "devices.list",
    "console.nav",
    "mystery.thing",
    "",
  ])
    assert.equal(mayWarm(cap), false, cap);
});

test("every way of warming goes through the allow-list: a pointer, a place, a row and a screen's query", async () => {
  const asked: string[] = [];
  let t = 0;
  const hooks = createRemoteScreenHooks({
    screens: new Map(),
    now: () => t,
    read: async (cap, input) => {
      asked.push(cap);
      return { cap, input };
    },
  });
  const BAD = ["goals.complete", "chat.thread", "connections.test", "mystery.thing"];
  for (const cap of BAD) hooks.prefetchCap(cap, {});
  // a place and a row that watched them once
  hooks.scope("somewhere");
  hooks.learn("kind", "id_1");
  const off = BAD.map((cap) => hooks.capQuery(cap, { id: "id_1" }).subscribe(() => undefined));
  await micro();
  for (const f of off) f(); // nobody watches them now; an unwatched answer is what warming would refresh
  asked.length = 0;
  hooks.invalidate();
  t += 60_000;
  hooks.warmScope("somewhere");
  hooks.warmLike("kind", "id_2");
  await micro();
  assert.deepEqual(
    asked.filter((c) => BAD.includes(c)),
    [],
    "none of them is read ahead",
  );
  hooks.close();
});
