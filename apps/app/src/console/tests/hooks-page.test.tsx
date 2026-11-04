// Console > Agents > Hooks: each control is pressed by its testID and the capability it calls is read back. Four hooks: an admin's command, one an agent made, a paused one and one that stopped something lately.
import test from "node:test";
import assert from "node:assert/strict";
import { HooksPage, madeByWords, needsYou, whereWords } from "../pages/Hooks.tsx";
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

test("Remove asks first, then removes that one hook", async () => {
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
  } finally { p.restore(); }
});

test("Add a hook opens the sheet; Add hook stays off until it says what to do, then saves a Space hook", async () => {
  const p = await mountPage(createRoot, <HooksPage />, ROWS, answer(), clock);
  try {
    await p.press("hooks-add");
    assert.ok(p.has("hook-sheet") && p.has("hook-what"), "the sheet is open");
    await p.press("sheet-submit");
    assert.equal(p.called("hooks.set").length, 0, "nothing is saved without words");
    await p.type("hook-what", "Confirm the file is not marked private");
    await p.type("hook-matcher", "files.*");
    await p.press("sheet-submit");
    assert.deepEqual(p.called("hooks.set").map((c) => c.input), [{ scope: "space", event: "tool.before", kind: "check", matcher: "files.*", instruction: "Confirm the file is not marked private", timeoutSec: 10 }]);
    assert.ok(!p.has("hook-sheet"), "the sheet closes once it is saved");
  } finally { p.restore(); }
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

test("empty: no hooks gives one sentence and an Add button that opens the sheet", async () => {
  const p = await mountPage(createRoot, <HooksPage />, { ...ROWS, "hooks.runs.list": { runs: [] } }, answer([], []), clock);
  try {
    assert.ok(p.has("hooks-empty") && p.text().includes("No hooks yet. Add one to run a check or a command when something happens."));
    assert.ok(!p.text().includes("Needs you"));
    await p.press("hooks-empty-action");
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
  } finally { p.restore(); }
});
