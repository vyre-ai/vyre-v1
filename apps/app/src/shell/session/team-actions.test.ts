// The Space menu's Invite People and Set Yourself Away reach the Space (audit 3 Nov): a real invite link on the clipboard, and away stored where teammates see it.
import test from "node:test";
import assert from "node:assert/strict";
import { AWAY_HOLD_MS, INVITE_DAYS, INVITE_ROLE, teamActions } from "./team-actions.ts";

function world(o: { fail?: string; clip?: "ok" | "none" | "throws" } = {}) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const flashes: string[] = [];
  const copied: string[] = [];
  let away = false;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (o.fail === cap) throw new Error("This needs an admin");
    if (cap === "members.invites.create") return { invite: { id: "inv_1" }, link: "https://northwind.example.com/join/K7P2-9QXA#fp=ab12" };
    if (cap === "notifications.away.get") return { away: true, until: 9 };
    return {};
  };
  const clip = o.clip === "none" ? () => undefined : () => ({ writeText: async (t: string) => { if (o.clip === "throws") throw new Error("denied"); copied.push(t); } });
  const a = teamActions({ call, hub: { flash: (t) => flashes.push(t), setAway: (on) => { away = on; } }, space: "Northwind", now: () => 1_000, clip });
  return { a, calls, flashes, copied, away: () => away };
}

test("Invite People makes a real one-time invite for a Member and copies its link", async () => {
  const w = world();
  const link = await w.a.invite();
  assert.equal(link, "https://northwind.example.com/join/K7P2-9QXA#fp=ab12");
  assert.deepEqual(w.copied, [link], "the clipboard holds the link the server made");
  const made = w.calls.find((c) => c.cap === "members.invites.create")!;
  assert.equal(made.input["role"], INVITE_ROLE);
  assert.equal(made.input["expiresInDays"], INVITE_DAYS);
  assert.ok(typeof made.input["idempotencyKey"] === "string");
  assert.match(w.flashes[0]!, /^Invite link copied\. One person can join Northwind with it as a Member for 7 days\.$/);
});

test("Invite People never says copied when it was not: a refusal and a blocked clipboard each say so", async () => {
  const refused = world({ fail: "members.invites.create" });
  assert.equal(await refused.a.invite(), null);
  assert.deepEqual(refused.copied, []);
  assert.match(refused.flashes[0]!, /^Couldn't make an invite link: This needs an admin$/);
  for (const clip of ["none", "throws"] as const) {
    const w = world({ clip });
    await w.a.invite();
    assert.ok(!/copied\./.test(w.flashes[0]!), String(w.flashes[0]));
    assert.match(w.flashes[0]!, /Copy it from Console, People: https:\/\/northwind/);
  }
});

test("Set Yourself Away is stored until I'm Back, and I'm Back clears it; the menu reads it at open", async () => {
  const w = world();
  await w.a.away(true);
  assert.deepEqual(w.calls.at(-1), { cap: "notifications.away.set", input: { until: 1_000 + AWAY_HOLD_MS, delegate: { kind: "none" } } });
  assert.equal(w.away(), true);
  await w.a.away(false);
  assert.equal(w.calls.at(-1)!.cap, "notifications.away.clear");
  assert.equal(w.away(), false);
  assert.equal(await w.a.load(), true, "away at open shows on the tile");
  assert.equal(w.away(), true);
  const failing = world({ fail: "notifications.away.set" });
  await failing.a.away(true);
  assert.equal(failing.away(), false, "a refused away does not show as away");
});
