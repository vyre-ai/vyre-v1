// The Chats sidebar's team rows (owner D21, D23, D24): the While you were away row at the very top only after an absence, Team now folded until opened, a steady dot on people.
import test from "node:test";
import assert from "node:assert/strict";
import { buildEntries } from "./model.ts";
import type { Entry, SidebarInput } from "./model.ts";
import { readPulse } from "./pulse.ts";

const base: SidebarInput = { faces: [], workingAgents: new Set(), groups: [], channels: [], filter: "all", closed: new Set(), people: [{ id: "usr_omar", name: "Omar Reyes" }, { id: "usr_bea", name: "Bea Baker" }] };
const keys = (es: readonly Entry[]): string[] => es.map((e) => e.key);
const team = { people: [{ id: "usr_bea", name: "Bea Baker", state: "online" as const }], agents: [{ id: "agt_intake", name: "Intake", line: "in #sales for Omar Reyes, on the Space", threadId: "thr_1" }] };

test("the While you were away row: first of all, only when there is a digest, never while searching", () => {
  assert.ok(!keys(buildEntries(base)).includes("digest"), "no absence, no row");
  assert.ok(!keys(buildEntries({ ...base, digest: { count: 0 } })).includes("digest"), "an empty digest draws nothing");
  const es = buildEntries({ ...base, digest: { count: 3 } });
  assert.equal(es[0]!.key, "digest");
  assert.deepEqual(es[0], { key: "digest", type: "digest", count: 3 });
  assert.ok(!keys(buildEntries({ ...base, digest: { count: 3 }, searching: true })).includes("digest"));
});

test("Team now: folded until opened, then the agents at work and the people around; absent in a Personal Space and when nobody is around", () => {
  const folded = buildEntries({ ...base, team, closed: new Set(["team"]) });
  const head = folded.find((e) => e.key === "h:team");
  assert.deepEqual(head, { key: "h:team", type: "head", section: "team", label: "Team now", count: 2, open: false });
  assert.ok(!keys(folded).some((k) => k.startsWith("w:") || k.startsWith("o:")), "folded shows only the head");
  const open = buildEntries({ ...base, team });
  const rows = open.filter((e) => e.type === "pulse");
  assert.deepEqual(rows, [
    { key: "w:agt_intake", type: "pulse", kind: "agent", id: "agt_intake", name: "Intake", line: "in #sales for Omar Reyes, on the Space", threadId: "thr_1" },
    { key: "o:usr_bea", type: "pulse", kind: "person", id: "usr_bea", name: "Bea Baker", line: "Online", presence: "online" },
  ]);
  assert.ok(!keys(buildEntries({ ...base, team, personal: true })).includes("h:team"));
  assert.ok(!keys(buildEntries({ ...base, team: { people: [], agents: [] } })).includes("h:team"));
});

test("People rows carry a steady dot: online or away, nothing for someone not around", () => {
  const es = buildEntries({ ...base, presence: new Map([["usr_bea", "away"]]) });
  const bea = es.find((e) => e.key === "p:usr_bea") as Extract<Entry, { type: "person" }>;
  const omar = es.find((e) => e.key === "p:usr_omar") as Extract<Entry, { type: "person" }>;
  assert.equal(bea.presence, "away");
  assert.equal(omar.presence, undefined);
});

test("one read of the pulse: the digest, presence and Now; a read that fails keeps what was there", async () => {
  const answers: Record<string, unknown> = {
    "home.digest": { digest: { id: "dgs_1", person: "usr_ada", periodStart: 1, periodEnd: 2, headline: ["2 things happened while you were away."], items: [{ kind: "notice", title: "Eve Evans joined", line: "Joined the Space." }, { kind: "notice", title: "x", line: "y" }], builtBy: "vyre" } },
    "devices.presence": { people: [{ personId: "usr_bea", state: "online" }, { personId: "usr_ada", state: "online" }] },
    "engine.now": { working: [{ agentId: "agt_intake", forPerson: "usr_omar", where: "space", since: 1, threadId: "thr_1", title: "sales", channelId: "chn_1" }] },
  };
  let down = false;
  const src = { call: async (cap: string) => { if (down && cap === "devices.presence") throw new Error("down"); return answers[cap]; }, personal: false, me: "usr_ada", personName: (id: string) => (id === "usr_bea" ? "Bea Baker" : "Omar Reyes"), agentName: () => "Intake" };
  const first = await readPulse(src, { digest: null, team: null, presence: new Map() });
  assert.equal(first.digest?.items.length, 2);
  assert.deepEqual([...first.presence], [["usr_bea", "online"], ["usr_ada", "online"]]);
  assert.deepEqual(first.team?.people.map((p) => p.id), ["usr_bea"], "you are left out of Now");
  assert.equal(first.team?.agents[0]?.line, "in #sales for Omar Reyes", "the narrow sidebar leaves out \"on the Space\"");
  down = true;
  const second = await readPulse(src, first);
  assert.deepEqual([...second.presence], [...first.presence], "a missed poll does not clear the dots");
  const personal = await readPulse({ ...src, personal: true }, first);
  assert.equal(personal.team, null);
});
