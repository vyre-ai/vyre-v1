// The crew block as tiles (lane r42-subagents, 19 Nov 2026, prototype sub42): side by side while two or more work, rows when it is narrow or done, one switch, and the same members in both shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { useState } from "react";
import { Pressable } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { CrewBlock } from "./CrewBlock.tsx";
import { toRunView, toRunViewFromNode } from "../crew/run-view.ts";
import { totalsOf } from "../crew/model.ts";
import type { CrewMember } from "../crew/model.ts";

installDom();

const S = (o: Partial<CrewMember> = {}): CrewMember =>
  ({
    kind: "subagent",
    id: "sub_a",
    parentThreadId: "thr_0",
    title: "Compare the bids",
    agentId: "agt_a",
    state: "working",
    steps: ["Opening the Harbor bid", "Reading the price table", "Checking what is left out", "Writing it up"],
    step: "Writing it up",
    startedAt: 1_000,
    elapsedMs: 8_000,
    tokensIn: 7_000,
    tokensOut: 1_400,
    costMicros: 20_000,
    ...o,
  }) as CrewMember;
const crew = (): CrewMember[] => [
  S(),
  S({
    id: "sub_b",
    title: "Three-year cost",
    state: "needs_you",
    steps: undefined as never,
    step: "Read the Deliveries calendar?",
  }),
  S({
    id: "sub_c",
    title: "Summary page",
    state: "failed",
    steps: undefined as never,
    step: undefined as never,
    found: "The price sheet has no tax column.",
  }),
  S({
    id: "sub_d",
    title: "Delivery dates",
    state: "done",
    steps: undefined as never,
    found: "Free the weeks of the 14th and 28th.",
    costMicros: 0,
    tokensIn: 0,
    tokensOut: 0,
  }),
];

test("the adapter reads one member as one RunView: the name, the task, up to three live lines, tokens and cost", () => {
  const r = toRunView(S());
  assert.equal(r.name, "Compare the bids");
  assert.equal(r.task, "");
  assert.deepEqual(r.lines, ["Reading the price table", "Checking what is left out", "Writing it up"]);
  assert.equal(r.tokens, 8_400);
  assert.equal(r.kind, "subagent");
  const t = toRunView(
    S({ kind: "teammate", name: "Tess", title: "Server fixes", branch: "crew/tess-1", steps: undefined as never }),
  );
  assert.deepEqual([t.name, t.task, t.kind, t.branch], ["Tess", "Server fixes", "coder", "crew/tess-1"]);
  assert.deepEqual(toRunView(S({ state: "done", found: "It works." })).lines, ["It works."]);
  assert.deepEqual(toRunView(S({ state: "needs_you", step: "Allow it?" })).lines, ["Allow it?"]);
  assert.deepEqual(toRunView(S({ state: "failed", found: undefined as never })).lines, []);
});

test("two or more at work in a wide column show as tiles, each with its own line window, tokens and cost", async () => {
  const members = crew();
  const root = await mount(
    createRoot,
    <CrewBlock members={members} totals={totalsOf(members)} width={900} onPeek={() => undefined} />,
  );
  assert.ok(find(root, "crew-tiles"));
  assert.equal(find(root, "crew-chip-sub_a"), null, "no rows beside the tiles");
  assert.match(textOf(find(root, "crew-tile-sub_a-window")), /Writing it up/);
  assert.ok(find(root, "crew-tile-sub_a-line-0"), "one line per step, up to three");
  assert.equal(find(root, "crew-tile-sub_a-line-3"), null);
  assert.match(textOf(find(root, "crew-tile-sub_a-meter")), /8\.4k tokens|8,400 tokens/);
  assert.equal(find(root, "crew-tile-sub_d-meter"), null, "a tile with nothing spent says nothing about money");
  assert.match(textOf(find(root, "crew-tile-sub_b-window")), /Read the Deliveries calendar\?/);
});

test("a tile that could not finish says why and offers Retry for that one; a tile that works has no Retry", async () => {
  const retried: string[] = [];
  const members = crew();
  const root = await mount(
    createRoot,
    <CrewBlock
      members={members}
      totals={totalsOf(members)}
      width={900}
      onPeek={() => undefined}
      onRetry={(m) => retried.push(m.id)}
    />,
  );
  assert.match(textOf(find(root, "crew-tile-sub_c-window")), /no tax column/);
  assert.equal(find(root, "crew-tile-sub_a-retry"), null);
  await press(find(root, "crew-tile-sub_c-retry"));
  assert.deepEqual(retried, ["sub_c"]);
});

test("pressing a tile opens that helper; the switch turns tiles into rows and back with the same members", async () => {
  const peeked: string[] = [];
  const members = crew();
  const root = await mount(
    createRoot,
    <CrewBlock members={members} totals={totalsOf(members)} width={900} onPeek={(m) => peeked.push(m.id)} />,
  );
  await press(find(root, "crew-tile-sub_b"));
  assert.deepEqual(peeked, ["sub_b"]);
  await press(find(root, "crew-strip-view"));
  assert.equal(find(root, "crew-tiles"), null);
  for (const m of members) assert.ok(find(root, `crew-chip-${m.id}`), `${m.id} is a row`);
  await press(find(root, "crew-strip-view"));
  assert.ok(find(root, "crew-tiles"));
  for (const m of members) assert.ok(find(root, `crew-tile-${m.id}`), `${m.id} is a tile`);
});

test("a narrow column, one helper, or nothing working shows rows and no switch", async () => {
  const members = crew();
  const narrow = await mount(
    createRoot,
    <CrewBlock members={members} totals={totalsOf(members)} width={480} onPeek={() => undefined} />,
  );
  assert.equal(find(narrow, "crew-tiles"), null);
  assert.equal(find(narrow, "crew-strip-view"), null);
  assert.ok(find(narrow, "crew-chip-sub_a"));
  const one = [S()];
  const alone = await mount(
    createRoot,
    <CrewBlock members={one} totals={totalsOf(one)} width={900} onPeek={() => undefined} />,
  );
  assert.equal(find(alone, "crew-tiles"), null);
  assert.equal(find(alone, "crew-strip-view"), null);
  const done = [S({ state: "done", found: "A" }), S({ id: "sub_b", state: "done", found: "B" })];
  const ended = await mount(
    createRoot,
    <CrewBlock members={done} totals={totalsOf(done)} width={900} onPeek={() => undefined} />,
  );
  assert.equal(find(ended, "crew-tiles"), null, "finished work reads as rows with its result");
  assert.ok(find(ended, "crew-strip-view"), "but the switch is there");
});

test("a person's choice stays when the work ends, and view='rows' keeps rows even while it works", async () => {
  const members = crew();
  const rows = await mount(
    createRoot,
    <CrewBlock members={members} totals={totalsOf(members)} width={900} view="rows" onPeek={() => undefined} />,
  );
  assert.equal(find(rows, "crew-tiles"), null);
  assert.ok(find(rows, "crew-chip-sub_a"));
  const forced = await mount(
    createRoot,
    <CrewBlock members={members} totals={totalsOf(members)} width={480} view="tiles" onPeek={() => undefined} />,
  );
  assert.equal(find(forced, "crew-tiles"), null, "even a forced view never tiles a narrow column");
});

test("a Run node reads as a RunView under the runtime's names: waiting is calm work, paused is a hold, succeeded is done", () => {
  const n = (o: Record<string, unknown>) =>
    toRunViewFromNode(
      {
        id: "run_1",
        kind: "helper",
        name: "Numbers",
        status: "running",
        spent: { tokensIn: 3000, tokensOut: 400, cacheRead: 1200, usdMicros: 25_000 },
        startedAt: 1_000,
        ...o,
      } as never,
      "Running the totals",
      11_000,
    );
  const run = n({});
  assert.deepEqual(
    [run.state, run.lines, run.tokens, run.costMicros, run.elapsedMs, run.cacheRead],
    ["working", ["Running the totals"], 3400, 25_000, 10_000, 1200],
  );
  const asleep = n({ status: "waiting", wake: { kind: "process", label: "Until the build finishes", wokeCount: 3 } });
  assert.deepEqual(
    [asleep.state, asleep.lines, asleep.wake?.wokeCount],
    ["working", ["Asleep until the build finishes"], 3],
  );
  assert.equal(n({ status: "paused" }).state, "needs_you");
  assert.deepEqual(n({ status: "succeeded", summary: "Done it", endedAt: 5_000 }).lines, ["Done it"]);
  assert.equal(n({ status: "succeeded", summary: "x", endedAt: 5_000 }).elapsedMs, 4_000);
  assert.deepEqual(n({ status: "failed", errorMessage: "No tax column" }).lines, ["No tax column"]);
  assert.equal(n({ kind: "crew" }).kind, "coder");
  assert.equal(n({ kind: "mystery" }).kind, "helper");
});

const HOLD = (state: CrewMember["state"] = "needs_you") => [
  S({ id: "sub_h", title: "Delivery dates", state, steps: undefined as never, step: "Read the Deliveries calendar?", holdTaskId: "tsk_hold" } as never),
  S({ id: "sub_w", title: "Summary page" }),
];
/** The held request as the Space serves it: an approval task that carries Allow and Deny, assigned to the person who may answer it. */
const taskFor = (who: string) => ({
  task: {
    id: "tsk_hold",
    kind: "approve",
    state: "awaiting_approval",
    createdBy: "agt_x",
    assigned: { kind: "person", id: who },
    actions: [
      { key: "approve", label: "Allow", note: "optional" },
      { key: "reject", label: "Deny", note: "required" },
    ],
  },
});
const rigCall = (who: string, fail = false) => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "tasks.get") return taskFor(who);
    if (cap === "tasks.act" && fail) throw new Error("down");
    return {};
  };
  return { call, calls };
};

test("a tile that waits on a held request offers Allow and Deny to someone who may answer it on the card, answers through tasks.act once, says what was answered and has the crew read again", async () => {
  const { call, calls } = rigCall("usr_me");
  let answered = 0;
  const members = HOLD();
  const root = await mount(createRoot, <CrewBlock members={members} totals={totalsOf(members)} width={900} call={call} meId="usr_me" onAnswered={() => answered++} onPeek={() => undefined} />);
  await flush();
  assert.ok(find(root, "crew-tile-sub_h-allow") && find(root, "crew-tile-sub_h-deny"));
  assert.equal(find(root, "crew-tile-sub_w-allow"), null, "a helper that is not waiting has no buttons");
  assert.equal(calls.filter((c) => c.cap === "tasks.get").length, 1, "the permission is read once for the request");
  await press(find(root, "crew-tile-sub_h-allow"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "tasks.act").map((c) => c.input), [{ taskId: "tsk_hold", action: "approve" }]);
  assert.match(textOf(find(root, "crew-tile-sub_h-decided")), /Allowed/);
  assert.equal(find(root, "crew-tile-sub_h-allow"), null, "answered once: no second press");
  assert.equal(answered, 1, "the crew is read again, so the card on the chat shows the answer too");
});

test("Deny asks for a reason, as the card does, and sends it with the reject; an empty reason sends nothing; a failed answer says so and the buttons come back", async () => {
  const ok = rigCall("usr_me");
  const members = HOLD();
  const root = await mount(createRoot, <CrewBlock members={members} totals={totalsOf(members)} width={900} call={ok.call} meId="usr_me" onPeek={() => undefined} />);
  await flush();
  await press(find(root, "crew-tile-sub_h-deny"));
  assert.ok(find(root, "crew-tile-sub_h-deny-reason"));
  await press(find(root, "crew-tile-sub_h-deny-go"));
  assert.equal(ok.calls.filter((c) => c.cap === "tasks.act").length, 0, "no reason, nothing sent");
  await typeInto(find(root, "crew-tile-sub_h-deny-reason"), "Not that calendar");
  await press(find(root, "crew-tile-sub_h-deny-go"));
  await flush();
  assert.deepEqual(ok.calls.filter((c) => c.cap === "tasks.act").map((c) => c.input), [{ taskId: "tsk_hold", action: "reject", note: "Not that calendar" }]);
  assert.match(textOf(find(root, "crew-tile-sub_h-decided")), /Denied/);
  const bad = rigCall("usr_me", true);
  const r2 = await mount(createRoot, <CrewBlock members={members} totals={totalsOf(members)} width={900} call={bad.call} meId="usr_me" onPeek={() => undefined} />);
  await flush();
  await press(find(r2, "crew-tile-sub_h-allow"));
  await flush();
  assert.match(textOf(find(r2, "crew-tile-sub_h-decide-failed")), /Could not answer/);
  assert.ok(find(r2, "crew-tile-sub_h-allow"), "tried again");
});

test("someone who could not answer on the card gets no buttons on the tile: another person's request, a request that cannot be read, no person, no held request, no way to answer", async () => {
  const members = HOLD();
  const other = rigCall("usr_else");
  const a = await mount(createRoot, <CrewBlock members={members} totals={totalsOf(members)} width={900} call={other.call} meId="usr_me" onPeek={() => undefined} />);
  await flush();
  assert.equal(find(a, "crew-tile-sub_h-allow"), null, "the request is another person's");
  assert.equal(find(a, "crew-tile-sub_h-deny"), null);
  const unreadable = async (cap: string): Promise<unknown> => {
    if (cap === "tasks.get") throw new Error("no");
    return {};
  };
  const b = await mount(createRoot, <CrewBlock members={members} totals={totalsOf(members)} width={900} call={unreadable} meId="usr_me" onPeek={() => undefined} />);
  await flush();
  assert.equal(find(b, "crew-tile-sub_h-allow"), null, "a request that cannot be read is not answered blind");
  const mine = rigCall("usr_me");
  const c = await mount(createRoot, <CrewBlock members={members} totals={totalsOf(members)} width={900} call={mine.call} onPeek={() => undefined} />);
  await flush();
  assert.equal(find(c, "crew-tile-sub_h-allow"), null, "no person known");
  const nohold = [S({ id: "sub_n", title: "x", state: "needs_you", steps: undefined as never, step: "Needs you" }), S({ id: "sub_m", title: "y" })];
  const d = await mount(createRoot, <CrewBlock members={nohold} totals={totalsOf(nohold)} width={900} call={mine.call} meId="usr_me" onPeek={() => undefined} />);
  await flush();
  assert.equal(find(d, "crew-tile-sub_n-allow"), null, "no held request");
  assert.equal(toRunView(members[0]!).holdTaskId, "tsk_hold");
});

test("answering on the card updates the tile: when the request is answered elsewhere the helper is no longer waiting and the buttons are gone", async () => {
  const { call } = rigCall("usr_me");
  const Host = (): ReturnType<typeof CrewBlock> => {
    const [on, setOn] = useState(true);
    const members = HOLD(on ? "needs_you" : "working");
    return (
      <>
        <Pressable testID="answered-on-card" onPress={() => setOn(false)}>
          {null}
        </Pressable>
        <CrewBlock members={members} totals={totalsOf(members)} width={900} call={call} meId="usr_me" onPeek={() => undefined} />
      </>
    ) as never;
  };
  const root = await mount(createRoot, <Host />);
  await flush();
  assert.ok(find(root, "crew-tile-sub_h-allow"));
  await press(find(root, "answered-on-card"));
  await flush();
  assert.equal(find(root, "crew-tile-sub_h-allow"), null);
  assert.equal(find(root, "crew-tile-sub_h-deny"), null);
});
