// Console > Agents > Hooks: each control is pressed by its testID and the capability it calls is read back. Four hooks: an admin's command, one an agent made, a paused one and one that stopped something lately.
import test from "node:test";
import assert from "node:assert/strict";
import { HooksPage, LATELY, lastRunWords, madeByWords, needsYou, restoreInput, whereWords } from "../pages/Hooks.tsx";
import { createRoot } from "test-renderer";
import { mountPage } from "./page-kit.tsx";
import type { Hook } from "../../places/chats/rightpane/hooks-model.ts";

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const hook = (id: string, over: Record<string, unknown> = {}): Hook => ({
  id, scope: "space", event: "tool.before", kind: "check", matcher: "", line: `Line of ${id}`, paused: false, madeBy: "usr_sara", madeByKind: "admin", helpers: false, timeoutSec: 10,
  createdAt: 1, updatedAt: 1, spec: { instruction: `Check ${id}` }, mine: false, canChange: true, ...over,
}) as Hook;
const SPACE = [
  hook("hk_cmd", { kind: "command", event: "tool.after", line: "After a tool runs, format the changed files", spec: { command: "npm run format" } }),
  hook("hk_paused", { paused: true, line: "Before a tool runs, check the file is not private" }),
  hook("hk_block", { line: "Before anything leaves Vyre, check the address is in Contacts" }),
];
const AGENT = [hook("hk_agent", { scope: "agent", agentId: "agt_a", madeBy: "agt_a", madeByKind: "agent", kind: "action", spec: { cap: "notes.add", input: {} }, line: "After a turn ends, add a line to the weekly notes", event: "turn.end" })];
const run = (id: number, hookId: string, outcome: string, at: number, detail?: string) => ({ id, hookId, event: "tool.before", outcome, ms: 12, at, ...(detail ? { detail } : {}) });
const RUNS = [run(1, "hk_cmd", "ok", NOW - 3 * 60_000), run(2, "hk_block", "blocked", NOW - 2 * 3_600_000, "The address is not in Contacts"), run(3, "hk_block", "ok", NOW - 5 * 3_600_000), run(4, "hk_agent", "error", NOW - 30 * 86_400_000, "old")];
const ROWS = {
  "hooks.policy.get": { agentHooks: true },
  "hooks.runs.list": { runs: RUNS },
  "agents.list": { agents: [{ agentId: "agt_a", name: "Assistant" }] },
};
const answer = (list: Hook[] = SPACE, mine: Hook[] = AGENT) => (cap: string, input: Record<string, unknown>): unknown => {
  if (cap === "hooks.list") return { hooks: input["scope"] === "agent" ? mine : list, agentHooks: true };
  if (cap === "hooks.set") return { hook: hook("hk_new") };
  if (cap === "hooks.pause") return { hook: hook(String(input["id"])) };
  if (cap === "hooks.allow_remove") return { removed: true };
  if (cap === "hooks.remove") return { removed: true };
  if (cap === "hooks.policy.set") return { agentHooks: input["agentHooks"] };
  return {};
};
const clock = { clock: () => ({ now: NOW }) };

test("plain words: where a hook applies, who made it, and which runs need a person", () => {
  const nameOf = (id: string): string => ({ usr_sara: "Sara Malik", agt_a: "Assistant" })[id] ?? id;
  assert.equal(whereWords({ scope: "space" }, nameOf), "Space");
  assert.equal(whereWords({ scope: "agent", agentId: "agt_a" }, nameOf), "Assistant everywhere");
  assert.equal(madeByWords({ madeBy: "usr_sara", madeByKind: "admin" }, nameOf), "Made by Sara Malik (admin)");
  assert.equal(madeByWords({ madeBy: "agt_a", madeByKind: "agent" }, nameOf), "Made by Assistant (agent)");
  assert.equal(madeByWords({ madeBy: "usr_sara", madeByKind: "person" }, nameOf), "Made by Sara Malik");
  assert.deepEqual(["ok", "blocked", "error", "timeout"].map((o) => lastRunWords({ outcome: o } as never, "check")), ["allowed", "stopped one", "failed", "ran out of time"]);
  assert.equal(lastRunWords({ outcome: "ok" } as never, "command"), "ran");
  const need = needsYou(RUNS as never, NOW);
  assert.deepEqual(need.map((r) => r.hookId), ["hk_block"], "only the newest bad run of a hook, and only from the last week");
});

test("the list: the Space's hooks and the ones Space agents made, with who made each, paused state and the Needs you strip", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    const t = p.text();
    for (const id of ["hk_cmd", "hk_paused", "hk_block", "hk_agent"]) assert.ok(p.has(`row-hook-${id}`), `${id} is listed`);
    assert.ok(/Made by .*\(admin\)/.test(t) && t.includes("(agent)") && t.includes("Paused"), "made-by kinds and paused state");
    assert.ok(t.includes("Needs you") && p.has("row-hook-need-hk_block") && t.includes("Stopped something: The address is not in Contacts"), "the blocked hook is in Needs you");
    assert.ok(!p.has("row-hook-need-hk_agent"), "an old error is not in Needs you");
    assert.deepEqual(p.called("hooks.list").map((c) => c.input), [{ scope: "space" }, { scope: "agent", agentId: "agt_a" }], "the Space list, then each Space agent");
    assert.equal(p.called("agents.list")[0]?.input["section"], "space", "only Space agents are read");
    assert.ok(p.has("hooks-add") && !p.has("hooks-empty"));
    assert.deepEqual(p.called("hooks.runs.list").map((c) => c.input), [{ limit: 200 }, { scope: "space", since: NOW - LATELY, outcomes: ["blocked", "error", "timeout"], limit: 200 }], "the strip asks the server for the Space's bad runs of the last week");
  } finally { p.restore(); }
});

test("the switch turns agents' own hooks off and on", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    await p.press("hooks-own-switch");
    assert.deepEqual(p.called("hooks.policy.set").map((c) => c.input), [{ agentHooks: false }]);
  } finally { p.restore(); }
});

test("Pause pauses a running hook and Resume turns a paused one back on", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    await p.press("hook-pause-hk_cmd");
    await p.press("hook-pause-hk_paused");
    assert.deepEqual(p.called("hooks.pause").map((c) => c.input), [{ id: "hk_cmd", paused: true }, { id: "hk_paused", paused: false }]);
    assert.ok(p.text().includes("Resume"), "a paused hook offers Resume");
  } finally { p.restore(); }
});

test("Remove is a quiet button; it asks first with a red Remove, then says Removed with an Undo that makes the same hook again", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    await p.press("hook-remove-hk_agent");
    assert.equal(p.called("hooks.remove").length, 0, "nothing is removed before the confirmation");
    assert.ok(p.text().includes("Remove this hook?"));
    await p.press("hook-remove-cancel");
    assert.equal(p.called("hooks.remove").length, 0);
    await p.press("hook-remove-hk_agent");
    await p.press("hook-remove-confirm");
    assert.deepEqual(p.called("hooks.remove").map((c) => c.input), [{ id: "hk_agent" }]);
    assert.ok(p.has("hook-removed") && p.text().includes("Removed."), "a Removed note");
    await p.press("hook-undo");
    assert.deepEqual(p.called("hooks.set").map((c) => c.input), [{ scope: "agent", event: "turn.end", kind: "action", cap: "notes.add", input: {}, timeoutSec: 10, summary: "After a turn ends, add a line to the weekly notes", helpers: false, paused: false, agentId: "agt_a" }], "Undo sets the removed hook again with its own fields");
    assert.ok(!p.has("hook-removed"), "the note goes once it is undone");
  } finally { p.restore(); }
});

test("Add a hook opens the sheet; Add hook stays off until it says what to do, then saves a Space hook", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    await p.press("hooks-add");
    assert.ok(p.has("hook-sheet") && p.has("hook-what"), "the sheet is open");
    const sheet = p.text();
    for (const w of ["When", "Do this", "Only for", "Limits this hook to one type of action. Leave it on Any action to run for all.", "Stop after (seconds)", "Add hook", "Cancel", "Check with an instruction"]) assert.ok(sheet.includes(w), `the sheet says ${w}`);
    assert.doesNotMatch(sheet, /matcher|\bkind\b|timeout|time limit/i, "plain words, not field names");
    await p.press("sheet-submit");
    assert.equal(p.called("hooks.set").length, 0, "nothing is saved without words");
    await p.type("hook-what", "Confirm the file is not marked private");
    await p.press("sheet-submit");
    assert.deepEqual(p.called("hooks.set").map((c) => c.input), [{ scope: "space", event: "tool.before", kind: "check", instruction: "Confirm the file is not marked private", timeoutSec: 10 }]);
    assert.ok(!p.has("hook-sheet"), "the sheet closes once it is saved");
  } finally { p.restore(); }
});

test("restoreInput carries a command hook's arguments and a check hook's matcher", () => {
  assert.deepEqual(restoreInput(hook("a", { kind: "command", spec: { command: "fmt", args: ["--all"] }, matcher: "files.*" })), { scope: "space", event: "tool.before", kind: "command", matcher: "files.*", command: "fmt", args: ["--all"], timeoutSec: 10, summary: "Line of a", helpers: false, paused: false });
  assert.deepEqual(restoreInput(hook("b", { spec: { instruction: "Be careful" }, paused: true })), { scope: "space", event: "tool.before", kind: "check", instruction: "Be careful", timeoutSec: 10, summary: "Line of b", helpers: false, paused: true });
});

test("a hook the person cannot change has Pause and Remove off", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer([hook("hk_locked", { canChange: false })], []), clock);
  try {
    await p.press("hook-pause-hk_locked");
    await p.press("hook-remove-hk_locked");
    assert.equal(p.called("hooks.pause").length, 0);
    assert.ok(!p.text().includes("Remove this hook?"));
  } finally { p.restore(); }
});

test("empty: no hooks gives one sentence and an Add a hook button that opens the sheet", async () => {
  const p = await mountPage(createRoot, <HooksPage />, { ...ROWS, "hooks.runs.list": { runs: [] } }, answer([], []), clock);
  try {
    assert.ok(p.has("hooks-empty") && p.text().includes("No hooks yet. Add one to run a check or a command when something happens."));
    assert.ok(!p.text().includes("Needs you"));
    await p.press("hooks-add");
    assert.ok(p.has("hook-sheet"));
  } finally { p.restore(); }
});

test("a run that failed or ran out of time is in Needs you with Pause beside it", async () => {
  const runs = [run(1, "hk_cmd", "error", NOW - 60_000, "The script exited with 1"), run(2, "hk_paused", "timeout", NOW - 120_000)];
  const p = await mountPage(createRoot, <HooksPage />, { ...ROWS, "hooks.runs.list": { runs } }, answer(), clock);
  try {
    const t = p.text();
    assert.ok(t.includes("Did not run: The script exited with 1") && t.includes("Took too long"));
    await p.press("hook-need-pause-hk_cmd");
    assert.deepEqual(p.called("hooks.pause").map((c) => c.input), [{ id: "hk_cmd", paused: true }]);
    assert.ok(p.has("hook-need-resume-hk_paused"), "a paused hook that timed out offers Resume");
  } finally { p.restore(); }
});

test("no label on the page uses the words the Console dropped", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    await p.press("hooks-add");
    assert.doesNotMatch(p.text(), /\b(principal|grant|actor|schema|gate|suppression|retention|tenant|scope|capability|trace)s?\b/i);
    assert.doesNotMatch(p.text(), /!|—/);
    assert.doesNotMatch(p.text(), /Company only|by label|capabilit/i);
  } finally { p.restore(); }
});

test("Only for is a plain-words picker defaulting to Any action; each choice maps to a matcher on the server's names", async () => {
  const { ACTION_CHOICES, matcherFor, choiceFor, matches, namesOf } = await import("../../../../../lib/hooks.ts");
  assert.deepEqual(ACTION_CHOICES.map((c) => c.title), ["Any action", "Sending an email", "Sending a text", "Running a command", "Changing a file", "Opening a link", "Moving money"]);
  assert.equal(matcherFor("any"), "", "Any action is no limit");
  assert.equal(choiceFor(matcherFor("email")), "email");
  assert.equal(choiceFor("something.else"), "any");
  const email = matcherFor("email");
  assert.ok(namesOf({ cap: "mail.send" }).some((n) => matches(email, n)) && namesOf({ cap: "resend.send_email" }).some((n) => matches(email, n)));
  assert.ok(!namesOf({ cap: "files.write" }).some((n) => matches(email, n)));
  assert.ok(namesOf({ tool: "Bash" }).some((n) => matches(matcherFor("command"), n)));
  assert.ok(namesOf({ cap: "stripe.charge" }).some((n) => matches(matcherFor("money"), n)), "a family name matches");
  for (const c of ACTION_CHOICES) assert.doesNotMatch(c.title, /_|\./, "no tool names on the page");
});

const RULES = [{ id: "al_1", what: "sending an email to sara@acme.com", by: "usr_sara", createdAt: 1 }, { id: "al_2", what: "opening a link on acme.com", by: "usr_sara", createdAt: 2 }];

test("a hook with rules shows each as Always allowed for, Stop allowing ends one and the list refreshes, and the row keeps one Remove", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer([hook("hk_r", { allowed: RULES }), hook("hk_plain"), hook("hk_empty", { allowed: [] })], []), clock);
  try {
    const t = p.text();
    assert.ok(t.includes("Always allowed for sending an email to sara@acme.com") && t.includes("Always allowed for opening a link on acme.com"));
    assert.ok(p.has("hook-allowed-al_1") && p.has("hook-allowed-al_2") && p.has("hook-allowed-stop-al_2"));
    assert.equal((t.match(/Always allowed for/g) ?? []).length, 2, "hooks without rules show no rule lines");
    assert.equal((t.match(/Stop allowing/g) ?? []).length, 2);
    assert.equal((t.match(/Remove/g) ?? []).length, 3, "one Remove per hook, none per rule");
    const before = p.called("hooks.list").length;
    await p.press("hook-allowed-stop-al_2");
    assert.deepEqual(p.called("hooks.allow_remove").map((c) => c.input), [{ id: "al_2" }]);
    assert.ok(p.called("hooks.list").length > before, "the list is read again");
  } finally { p.restore(); }
});

test("Stop allowing is off when the person cannot change the hook", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer([hook("hk_l", { canChange: false, allowed: RULES })], []), clock);
  try {
    await p.press("hook-allowed-stop-al_1");
    assert.equal(p.called("hooks.allow_remove").length, 0);
  } finally { p.restore(); }
});

test("a hook with no run says Never ran when the read answered in full, and Not run lately when it was cut off or failed", async () => {
  const { neverWords, RUNS_LIMIT } = await import("../pages/Hooks.tsx");
  assert.equal(neverWords([], true), "Never ran");
  assert.equal(neverWords(new Array(RUNS_LIMIT - 1).fill({}), true), "Never ran");
  assert.equal(neverWords(new Array(RUNS_LIMIT).fill({}), true), "Not run lately", "cut off at the limit: an older run may be past it");
  assert.equal(neverWords([], false), "Not run lately", "the read failed");
});
