// Agents in the person's own Chrome (Chrome step 2, part A): one tab group per agent named "Vyre · <agent>" and coloured, Take over and Stop on the bar, a held send shown as
// "Waiting for you in Vyre" in the page while the approval card waits in the chat, and the card's To, From, Subject and Message read from the page without a secret.
import test from "node:test";
import assert from "node:assert/strict";
import { createSessions, groupColor, groupTitle, GROUP_COLORS } from "../src/agent/sessions.js";
import { composeFacts } from "../src/agent/page.js";

function world() {
  const w: any = { events: [] as any[], groups: new Map<number, any>(), tabs: new Map<number, any>(), overlay: [] as any[], nextGroup: 100, now: 1_000, ungrouped: [] as number[] };
  for (const id of [1, 2, 3]) w.tabs.set(id, { id, groupId: -1 });
  w.ext = {
    scripting: { executeScript: async ({ func, args }: any) => { if (func.name === "overlayShow") w.overlay.push(args[0]); return [{ frameId: 0, result: true }]; } },
    tabs: {
      get: async (id: number) => { const t = w.tabs.get(id); if (!t) throw new Error("no tab"); return { ...t }; },
      group: async ({ tabIds, groupId }: any) => {
        let g = groupId;
        if (g !== undefined && !w.groups.has(g)) throw new Error("No group with id: " + g);
        if (g === undefined) { g = w.nextGroup++; w.groups.set(g, {}); }
        for (const id of tabIds) w.tabs.get(id).groupId = g;
        return g;
      },
    },
    tabGroups: { update: async (g: number, props: any) => { Object.assign(w.groups.get(g), props); } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  };
  const s = createSessions({
    ext: w.ext, cdp: { detach: async () => {} }, traffic: { forget() {} }, emit: (e: any) => w.events.push(e), now: () => w.now,
    setTimer: () => 0, clearTimer: () => {},
  } as any);
  w.s = s;
  return w;
}
const call = (id = "agt_scout", name = "Scout") => ({ agent: { id, name }, space: "spc_a" });

test("each agent gets one coloured tab group named Vyre · <agent>, made once and found again", async () => {
  const w = world();
  await w.s.begin(call(), 1);
  await w.s.begin(call(), 2);
  assert.equal(w.groups.size, 1, "one group for the agent");
  const [gid, g] = [...w.groups.entries()][0];
  assert.equal(g.title, "Vyre · Scout");
  assert.ok(GROUP_COLORS.includes(g.color));
  assert.equal(g.color, groupColor("agt_scout"), "the colour belongs to the agent");
  assert.deepEqual([w.tabs.get(1).groupId, w.tabs.get(2).groupId], [gid, gid]);
  await w.s.begin(call("agt_intake", "Intake"), 3);
  assert.equal(w.groups.size, 2, "another agent, another group");
  assert.notEqual(w.tabs.get(3).groupId, gid);
  assert.equal(groupTitle("x".repeat(40)).length, "Vyre · ".length + 24);
});

test("a group the person closed is made again; a tab that is already in the group is left alone", async () => {
  const w = world();
  await w.s.begin(call(), 1);
  const [gid] = [...w.groups.keys()];
  w.groups.delete(gid);
  w.tabs.get(1).groupId = -1;
  await w.s.group(call().agent, 2);
  assert.equal(w.groups.size, 1);
  assert.notEqual(w.tabs.get(2).groupId, gid, "a new group");
  const before = w.nextGroup;
  await w.s.group(call().agent, 2);
  assert.equal(w.nextGroup, before, "no regrouping");
});

test("in an agent computer there is nobody to look at tab groups", async () => {
  const w = world();
  const s = createSessions({ ext: w.ext, cdp: { detach: async () => {} }, traffic: { forget() {} }, emit: () => {}, grouping: () => false, setTimer: () => 0, clearTimer: () => {} } as any);
  await s.begin(call(), 1);
  assert.equal(w.groups.size, 0);
});

test("a held send turns the bar to Waiting for you in Vyre, carries the card, and Don't send forgets it", async () => {
  const w = world();
  await w.s.begin(call(), 1);
  const id = w.s.hold(call(), 1, { kind: "send", why: "looks like a send", summary: "send: Send on mail.test", card: { to: "dana@firm.test", subject: "Hello", message: "Hi Dana" }, selector: null, action: { type: "press", key: "Enter" } });
  await new Promise((r) => setImmediate(r));
  const held = w.events.find((e: any) => e.event === "held");
  assert.equal(held.id, id);
  assert.equal(held.name, "Scout");
  assert.deepEqual(held.card, { to: "dana@firm.test", subject: "Hello", message: "Hi Dana" });
  assert.equal(w.overlay.at(-1).waiting, true);
  assert.equal(w.s.heldOf("agt_scout")[0].card.to, "dana@firm.test");
  assert.equal(w.s.dropHeld(id), true);
  await new Promise((r) => setImmediate(r));
  assert.equal(w.overlay.at(-1).waiting, false);
  assert.equal(w.s.heldIds("agt_scout").length, 0);
});

test("Take over gives the tab back, keeps it in the group, and the agent waits until chrome_resume", async () => {
  const w = world();
  await w.s.begin(call(), 1);
  await w.s.pause("agt_scout", "takeover");
  assert.equal(w.s.driverOf(1), null);
  assert.equal(w.s.pausedFor("agt_scout").by, "takeover");
  assert.ok(w.events.some((e: any) => e.event === "takeover" && e.agent === "agt_scout"));
  assert.ok(w.events.some((e: any) => e.event === "driving" && e.on === false));
  assert.notEqual(w.tabs.get(1).groupId, -1, "still in the agent's group");
  assert.equal(await w.s.resume("agt_scout"), true);
});

test("composeFacts reads To, From, Subject and the message beside the control, never a secret", () => {
  const field = (o: any) => ({ tagName: o.tag ?? "INPUT", value: o.value, innerText: o.value, getAttribute: (n: string) => o.attrs?.[n] ?? null, id: o.id ?? "", labels: o.labels ?? [] });
  const els = [
    field({ attrs: { "aria-label": "To" }, value: "dana@firm.test" }),
    field({ attrs: { name: "from" }, value: "me@mine.test" }),
    field({ attrs: { placeholder: "Subject" }, value: "Hello" }),
    field({ tag: "TEXTAREA", attrs: { name: "body" }, value: "Hi Dana, the deed is ready." }),
    field({ attrs: { type: "password", name: "pw" }, value: "hunter2" }),
  ];
  const scope = { querySelectorAll: () => els };
  const btn = { closest: () => scope };
  (globalThis as any)[Symbol.for("vyre.agent.els")] = [btn];
  (globalThis as any).document = { getElementById: () => null };
  try {
    const out = composeFacts(0) as Record<string, string>;
    assert.equal(out["to"], "dana@firm.test");
    assert.equal(out["from"], "me@mine.test");
    assert.equal(out["subject"], "Hello");
    assert.equal(out["message"], "Hi Dana, the deed is ready.");
    assert.ok(!JSON.stringify(out).includes("hunter2"));
  } finally {
    delete (globalThis as any)[Symbol.for("vyre.agent.els")];
    delete (globalThis as any).document;
  }
});
