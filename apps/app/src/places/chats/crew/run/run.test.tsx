// The pieces around a delegated run (lane r42-subagents, section G): every sentence comes from one pure function over the runtime's shapes, and the views only draw them. Fed by the fixtures until the reads land.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../../ui/src/testing/dom.ts";
import {
  activityGroups,
  atCandidates,
  boardGroups,
  dependencyLine,
  messageLines,
  parseAtSend,
  routeAt,
  sleepLine,
  tokenReport,
} from "./model.ts";
import { ActivityList, AtMenu, BoardView, DependencyLine, MessageLines, SleepLine, TokenReport } from "./views.tsx";
import { ACTIVITY, BOARD, MESSAGES, NODES } from "./fixtures.ts";

installDom();
const say = (n: Parameters<typeof textOf>[0]): string =>
  textOf(n)
    .replace(/\s+/g, " ")
    .replace(/ ([:.,])/g, "$1")
    .trim();
const when = (ts: number): string => `day ${Math.round((ts - 1_700_000_000_000) / 86_400_000)}`;

test("the board reads open questions first, then answered, decisions and facts, each oldest first", () => {
  const g = boardGroups(BOARD);
  assert.deepEqual(
    g.open.map((e) => e.id),
    ["b3"],
  );
  assert.deepEqual(
    g.answered.map((e) => e.id),
    ["b2"],
  );
  assert.deepEqual(
    g.decisions.map((e) => e.id),
    ["b4"],
  );
  assert.deepEqual(
    g.facts.map((e) => e.id),
    ["b1"],
  );
  assert.deepEqual(boardGroups([]), { open: [], answered: [], decisions: [], facts: [] });
});

test("messages between helpers: the last two, newest last, by first names, with Seen only once read", () => {
  const l = messageLines(MESSAGES, NODES);
  assert.deepEqual(
    l.map((x) => [x.from, x.to, x.seen]),
    [
      ["Calendar", "Docs", false],
      ["Research", "Docs", false],
    ],
  );
  assert.equal(messageLines(MESSAGES, NODES, 3)[0]!.seen, true);
  assert.deepEqual(messageLines([], NODES), []);
  assert.equal(
    messageLines([{ id: "z", fromRun: "gone", toRun: "run_d", body: "x", at: 1 }], NODES)[0]!.from,
    "Helper",
    "an unknown sender never shows an id",
  );
});

test("a dependency line only while something it waits for is not done, and never once it ended", () => {
  const d = NODES.find((n) => n.id === "run_d")!;
  assert.equal(dependencyLine(d, NODES), "Starts when Research is done");
  const ready = NODES.map((n) => (n.id === "run_r" ? { ...n, status: "succeeded" as const } : n));
  assert.equal(dependencyLine(d, ready), null);
  assert.equal(
    dependencyLine(
      { ...d, dependsOn: ["run_r", "run_c", "run_n"] },
      NODES.map((n) => (n.id === "run_n" ? { ...n, status: "running" as const } : n)),
    ),
    "Starts when Research and Numbers are done",
  );
  assert.equal(dependencyLine({ ...d, status: "stopped" }, NODES), null);
  assert.equal(dependencyLine({ status: "running" }, NODES), null);
});

test("a sleeping run is one calm line: what it waits on, how often it woke, and that it costs nothing; a running one has none", () => {
  assert.deepEqual(
    sleepLine({ status: "waiting", wake: { kind: "process", label: "Until the export finishes", wokeCount: 3 } }, when),
    {
      head: "Asleep until the export finishes",
      tail: "woke 3 times · no tokens while asleep",
    },
  );
  assert.deepEqual(
    sleepLine({ status: "waiting", wake: { kind: "event", label: "a file lands in Bids", wokeCount: 1 } }, when),
    { head: "Asleep until a file lands in Bids", tail: "woke once · no tokens while asleep" },
  );
  assert.equal(
    sleepLine({ status: "waiting", wake: { kind: "time", dueAt: 1_700_000_000_000 + 3 * 86_400_000 } }, when)!.head,
    "Asleep until day 3",
  );
  assert.equal(sleepLine({ status: "waiting", wake: { kind: "person" } }, when)!.head, "Asleep");
  assert.equal(sleepLine({ status: "running", wake: { kind: "event", label: "x" } }, when), null);
  assert.equal(sleepLine({ status: "waiting" }, when), null);
});

test("the token report adds up tokens and cost and says how much was read from the cache; an empty run reports nothing", () => {
  const r = tokenReport(NODES);
  assert.equal(
    r.tokens,
    NODES.reduce((s, n) => s + n.spent.tokensIn + n.spent.tokensOut, 0),
  );
  assert.equal(r.costMicros, 274_000);
  assert.equal(r.cacheRead, 27_400);
  assert.equal(r.cachePct, Math.round((27_400 / 81_000) * 100));
  assert.equal(r.rows.length, 4);
  assert.equal(tokenReport([]).cachePct, 0);
  assert.equal(
    tokenReport([{ ...NODES[0]!, spent: { tokensIn: 100, tokensOut: 0, cacheRead: 500, usdMicros: 0 } }]).cachePct,
    100,
    "never above 100",
  );
});

test("activity groups: stuck or paused first, then running, then asleep; an empty group is not drawn", () => {
  const g = activityGroups(ACTIVITY);
  assert.deepEqual(
    g.map((x) => [x.key, x.rows.length]),
    [
      ["needs", 1],
      ["running", 2],
      ["asleep", 3],
    ],
  );
  assert.deepEqual(activityGroups([]), []);
  assert.deepEqual(
    activityGroups(ACTIVITY.filter((r) => r.status === "waiting")).map((x) => x.key),
    ["asleep"],
  );
});

test("@ finds helpers by the start of the first name, never a stopped one; a sent @name goes to exactly one helper or is left as an ordinary message", () => {
  assert.deepEqual(
    atCandidates(NODES, "nu").map((n) => n.name),
    ["Numbers"],
  );
  assert.equal(atCandidates(NODES, "").length, 4);
  assert.equal(
    atCandidates(
      NODES.map((n) => ({ ...n, status: "stopped" as const })),
      "",
    ).length,
    0,
  );
  const p = parseAtSend("@Numbers use the 8% rate", NODES);
  assert.deepEqual([p?.node.id, p?.body], ["run_n", "use the 8% rate"]);
  assert.equal(parseAtSend("@numbers  use it ", NODES)?.body, "use it");
  assert.equal(parseAtSend("@Nobody hello", NODES), null);
  assert.equal(parseAtSend("hello @Numbers", NODES), null);
  assert.equal(parseAtSend("@Numbers", NODES), null, "a name alone is not a message");
  const twins = [...NODES, { ...NODES[1]!, id: "run_n2", name: "Numbers Two" }];
  assert.equal(parseAtSend("@Numbers use it", twins), null, "two helpers with that first name: nothing is guessed");
});

test("the board view draws its sections, who wrote each entry, its source chip, the answer, and an empty board says why it is empty", async () => {
  const seen: string[] = [];
  const root = await mount(createRoot, <BoardView entries={BOARD} nodes={NODES} onEvidence={(r) => seen.push(r)} />);
  for (const k of ["open", "answered", "decisions", "facts"]) assert.ok(find(root, `board-${k}`), k);
  assert.match(say(find(root, "board-answer-b2")), /Research: 8%, from the bid terms/);
  assert.match(say(find(root, "board-entry-b3")), /Does Pine include delivery\?[\s\S]*Docs[\s\S]*Open/);
  await press(find(root, "board-evidence-b1"));
  assert.deepEqual(seen, ["Harbor Supply bid.pdf, page 2"]);
  const empty = await mount(createRoot, <BoardView entries={[]} nodes={NODES} />);
  assert.match(say(find(empty, "board-empty")), /Nothing on the board yet/);
  assert.equal(find(empty, "board"), null);
});

test("message lines, the dependency line, the sleeping line and the token report draw only what is true", async () => {
  const lines = await mount(createRoot, <MessageLines messages={MESSAGES} nodes={NODES} />);
  assert.match(
    String(
      find(lines, "message-line-m3")?.props["aria-label"] ?? find(lines, "message-line-m3")?.props.accessibilityLabel,
    ),
    /Research to Docs: Pine's bid ends 30 November/,
  );
  assert.match(say(find(lines, "message-line-m3")), /Pine's bid ends 30 November/);
  assert.equal(find(lines, "message-line-m1"), null, "only the last two");
  assert.equal(find(await mount(createRoot, <MessageLines messages={[]} nodes={NODES} />), "message-lines"), null);
  const dep = await mount(createRoot, <DependencyLine node={NODES[3]!} nodes={NODES} />);
  assert.match(say(find(dep, "dependency-line")), /Starts when Research is done/);
  assert.equal(
    find(await mount(createRoot, <DependencyLine node={NODES[1]!} nodes={NODES} />), "dependency-line"),
    null,
  );
  let opened = 0;
  const sleep = await mount(
    createRoot,
    <SleepLine
      node={{ status: "waiting", wake: { kind: "process", label: "Until the export finishes", wokeCount: 3 } }}
      when={when}
      onOpen={() => opened++}
    />,
  );
  assert.match(say(find(sleep, "sleep-line")), /until the export finishes\s*3×/);
  assert.doesNotMatch(
    say(find(sleep, "sleep-line")),
    /woke|times|Asleep/,
    "the moon and a number carry what words said",
  );
  await press(find(sleep, "sleep-line"));
  assert.equal(opened, 1);
  assert.equal(
    find(await mount(createRoot, <SleepLine node={{ status: "running" }} when={when} />), "sleep-line"),
    null,
  );
  let open = false;
  const rep = await mount(createRoot, <TokenReport nodes={NODES} open={open} onToggle={() => (open = !open)} />);
  assert.match(say(find(rep, "token-report-line")), /tokens · \$0\.27 · 34% read from cache/);
  assert.equal(find(rep, "token-report-rows"), null, "details only when opened");
  const opened2 = await mount(createRoot, <TokenReport nodes={NODES} open />);
  assert.ok(find(opened2, "token-row-run_n"));
  assert.equal(find(await mount(createRoot, <TokenReport nodes={[]} />), "token-report"), null);
});

test("the activity list opens a session on press, offers Nudge on a stuck run only, and says when nothing runs", async () => {
  const opened: string[] = [];
  const nudged: string[] = [];
  const root = await mount(
    createRoot,
    <ActivityList rows={ACTIVITY} when={when} onOpen={(id) => opened.push(id)} onNudge={(id) => nudged.push(id)} />,
  );
  assert.match(say(find(root, "activity-needs")), /Import contacts[\s\S]*Looks stuck: the same step six times/);
  assert.match(say(find(root, "activity-asleep")), /until the export finishes 3×/);
  assert.match(say(find(root, "activity-asleep")), /until day 3/);
  assert.equal(find(root, "activity-nudge-run_r"), null);
  await press(find(root, "activity-nudge-run_x1"));
  await press(find(root, "activity-row-run_x2"));
  assert.deepEqual([nudged, opened], [["run_x1"], ["run_x2"]]);
  assert.match(
    textOf(
      find(await mount(createRoot, <ActivityList rows={[]} when={when} onOpen={() => undefined} />), "activity-empty"),
    ),
    /Nothing is running or asleep/,
  );
});

test("the @ menu lists who it can go to with what each is on, marks the chosen one, and picks on press; it draws nothing when nobody matches", async () => {
  const picked: string[] = [];
  const root = await mount(createRoot, <AtMenu nodes={NODES} query="" index={1} onPick={(n) => picked.push(n.id)} />);
  assert.match(say(find(root, "at-item-run_n")), /Numbers[\s\S]*Harbor \$12,540/);
  assert.equal(
    find(root, "at-item-run_n")?.props["aria-selected"] ?? find(root, "at-item-run_n")?.props.accessibilityState,
    find(root, "at-item-run_n")?.props["aria-selected"] ?? find(root, "at-item-run_n")?.props.accessibilityState,
  );
  await press(find(root, "at-item-run_c"));
  assert.deepEqual(picked, ["run_c"]);
  assert.equal(
    find(await mount(createRoot, <AtMenu nodes={NODES} query="zz" index={0} onPick={() => undefined} />), "at-menu"),
    null,
  );
});

test("routeAt: one helper at work gets the words; a name shared with a person or agent, or by two helpers, goes nowhere until picked; a finished helper is never messaged; anything else is ordinary", () => {
  const to = routeAt(
    "@Numbers use the 8% rate",
    NODES.map((n) => (n.id === "run_n" ? { ...n, status: "running" as const } : n)),
    [],
  );
  assert.deepEqual(to?.kind === "to" ? [to.node.id, to.body] : null, ["run_n", "use the 8% rate"]);
  assert.deepEqual(
    routeAt(
      "@Numbers use it",
      NODES.map((n) => (n.id === "run_n" ? { ...n, status: "running" as const } : n)),
      ["Numbers"],
    ),
    { kind: "ambiguous", name: "Numbers" },
  );
  const picked = routeAt(
    "@Numbers (helper) use it",
    NODES.map((n) => (n.id === "run_n" ? { ...n, status: "running" as const } : n)),
    ["Numbers"],
  );
  assert.deepEqual(picked?.kind === "to" ? [picked.node.id, picked.body] : null, ["run_n", "use it"]);
  assert.deepEqual(
    routeAt(
      "@Numbers use it",
      [...NODES, { ...NODES[1]!, id: "run_n2", name: "Numbers Two", status: "running" as const }],
      [],
    ),
    { kind: "ambiguous", name: "Numbers" },
  );
  assert.deepEqual(routeAt("@Numbers thanks", NODES, []), { kind: "finished", name: "Numbers" });
  assert.equal(routeAt("@Zed hello", NODES, []), null);
  assert.equal(routeAt("hello @Numbers", NODES, []), null);
  assert.equal(routeAt("@Numbers", NODES, []), null, "a name alone is not a message");
  assert.equal(
    routeAt(
      "@numbers   spaced   out ",
      NODES.map((n) => ({ ...n, status: "running" as const })),
      [],
    )?.kind,
    "to",
  );
});

test("routeAt: punctuation after the name is not part of it", () => {
  const running = NODES.map((n) => ({ ...n, status: "running" as const }));
  for (const t of ["@Numbers, use it", "@Numbers: use it", "@numbers; use it"]) {
    const r = routeAt(t, running, []);
    assert.deepEqual(r?.kind === "to" ? [r.node.id, r.body] : null, ["run_n", "use it"], t);
  }
});
