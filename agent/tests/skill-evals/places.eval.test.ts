// The per-place skill evals: scripted scenarios for Records, Files, Automations, loops, the computer, Inbox, Apps and the Console, replayed against the frozen tool list and the place rubric.
// A scenario is a prompt and the trace a model that follows the focus skills produces. A change to a skill, the tool list or a tool's schema that breaks one fails here, by rule name.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { loadGenerated } from "../../src/tools/harness.ts";
import { PLACE_RULES, evaluatePlace } from "./place-rules.ts";
import type { Scenario, Step, Tools, World } from "./rules.ts";

const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const evalSet = JSON.parse(read("agent/skills/working-in-vyre/places.eval.json")) as { version: number; world: World; scenarios: Scenario[] };
const registry = JSON.parse(read("generated/registry.json")) as { $defs: Record<string, JsonSchema> };
const gen = loadGenerated();
const tools: Tools = { byName: (n) => gen.catalog.byName(n), isListed: (n) => gen.defaults.has(n), defs: registry.$defs };
const world = evalSet.world;
const scenario = (id: string): Scenario => { const s = evalSet.scenarios.find((x) => x.id === id); assert.ok(s, `scenario ${id}`); return structuredClone(s); };
const broken = (s: Scenario): string[] => [...new Set(evaluatePlace(s, world, tools).map((v) => v.rule))];
const calls = (s: Scenario) => s.trace.filter((t): t is Extract<Step, { call: string }> => "call" in t);

const PLACES = ["records", "files", "automations", "loop", "computer", "inbox", "apps", "console"];

test("the place eval set has scenarios for every place, each with a prompt, a trace and rules that exist", () => {
  assert.equal(evalSet.version, 1);
  assert.equal(new Set(evalSet.scenarios.map((s) => s.id)).size, evalSet.scenarios.length, "ids are unique");
  for (const p of PLACES) assert.ok(evalSet.scenarios.some((s) => s.id.startsWith(p)), `no scenario for ${p}`);
  for (const s of evalSet.scenarios) {
    assert.ok(s.prompt.length > 0 && s.trace.length > 0 && s.rules.length > 0, s.id);
    for (const r of s.rules) assert.ok(r in PLACE_RULES, `${s.id}: rule ${r}`);
  }
});

test("every place scenario passes: no rule is broken, every tool is real, found and called with a valid input", () => {
  for (const s of evalSet.scenarios) assert.deepEqual(evaluatePlace(s, world, tools), [], s.id);
});

test("together the place scenarios exercise every place rule", () => {
  const used = new Set(evalSet.scenarios.flatMap((s) => s.rules));
  for (const r of Object.keys(PLACE_RULES)) if (r !== "secret_never_printed") assert.ok(used.has(r), `no scenario exercises ${r}`);
});

type Mutation = [id: string, rule: string, mutate: (s: Scenario) => void];
const mutations: Mutation[] = [
  ["records-describe-then-update", "schema_before_write", (s) => { s.trace.splice(0, 1); }],
  ["records-count-honest", "count_is_honest", (s) => { s.trace[s.trace.length - 1] = { say: "25 contacts came in from the website this month." }; }],
  ["files-edit-with-base-version", "read_then_write_with_base", (s) => { s.trace.splice(0, 1); }],
  ["files-edit-with-base-version", "read_then_write_with_base", (s) => { delete (calls(s)[1]!.input as { baseVersion?: number }).baseVersion; }],
  ["files-review-folder-waits", "waiting_not_done", (s) => { s.trace[s.trace.length - 1] = { say: "The fix is done and is live in the folder." }; }],
  ["automations-validate-test-enable", "validate_test_enable", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "automations_validate"); }],
  ["automations-validate-test-enable", "validate_test_enable", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "automations_test"); }],
  ["automations-fix-failed-run", "validate_test_enable", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "runs_steps"); }],
  ["loop-weekly-in-utc", "loop_in_utc", (s) => { (calls(s).find((c) => c.call === "agents_routine_save")!.input as { cron: string }).cron = "0 9 * * 1"; }],
  ["loop-weekly-in-utc", "loop_in_utc", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "agents_routine_save"); s.trace[s.trace.length - 1] = { say: "I'll remember to send them every Monday." }; }],
  ["loop-weekly-in-utc", "loop_in_utc", (s) => { s.trace[s.trace.length - 1] = { say: "Set. Every Monday at 09:00 Karachi time." }; }],
  ["loop-change-in-place", "change_in_place", (s) => { delete (calls(s).find((c) => c.call === "agents_routine_save")!.input as { routineId?: string }).routineId; }],
  ["computer-wake-then-browse", "computer_state", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "computers_wake"); }],
  ["computer-wake-then-browse", "computer_state", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "chrome_snapshot"); }],
  ["inbox-draft-not-send", "draft_unless_send", (s) => { calls(s)[0]!.call = "mail_send"; }],
  ["apps-publish-asks-first", "publish_asks_first", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "ask_question"); }],
  ["apps-publish-asks-first", "held_means_wait", (s) => { s.trace[s.trace.length - 1] = { say: "Published. The form is live." }; }],
  ["console-propose-diff", "propose_not_apply", (s) => { s.trace.splice(s.trace.length - 1, 0, { call: "console_diff_apply", input: { diffId: "dif_a1b2c3" } }); }],
  ["console-propose-diff", "propose_not_apply", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "console_explain_access"); }],
];

for (const [id, rule, mutate] of mutations) {
  test(`the place rubric catches it: ${rule} on a changed ${id}`, () => {
    const s = scenario(id);
    assert.deepEqual(broken(s), [], "the scenario is clean before the change");
    mutate(s);
    assert.ok(broken(s).includes(rule), `${rule} should fire; got ${JSON.stringify(broken(s))}`);
  });
}

test("every tool the place scenarios call is named in a built-in skill", () => {
  const skills = ["working-in-vyre", "focus-records", "focus-files", "focus-automations", "focus-vault", "focus-inbox", "focus-apps", "focus-console", "agent-loops", "agent-computer"].map((d) => read(`agent/skills/${d}/SKILL.md`)).join("\n");
  const named = new Set([...skills.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]!));
  for (const c of evalSet.scenarios.flatMap(calls)) assert.ok(named.has(c.call), `${c.call} is used by a scenario and named in no skill`);
});
