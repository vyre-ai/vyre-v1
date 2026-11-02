// The about-vyre skill and its evals. The owner asked his Assistant "What do you think about Vyre?" and said he was weighing it as a replacement for his Claude and Codex CLIs; the answers said
// memory knew nothing about Vyre, that Codex did not look supported, and that it could not tell how long sessions, crashes, branches or pull requests are handled. These scenarios replay
// answers that follow the skill against the frozen tool list, prove each fact they give is in the skill, and catch every answer he got by name.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { loadGenerated } from "../../src/tools/harness.ts";
import { CLI_IDS } from "../../src/drivers/cli/types.ts";
import { API_IDS } from "../../src/drivers/api/types.ts";
import { ABOUT_VYRE_INTENT, ABOUT_VYRE_TOOLS } from "../../../lib/about-vyre.ts";
import { CREW_TOOLS } from "../../../lib/connector-chat.ts";
import { ABOUT_RULES, ANSWERS_HE_GOT, OWNER_WORDS, evaluateAbout } from "./about-rules.ts";
import type { AboutScenario, AboutWorld } from "./about-rules.ts";
import type { Step, Tools, World } from "./rules.ts";

const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const SKILL = read("agent/skills/about-vyre/SKILL.md");
const evalSet = JSON.parse(read("agent/skills/about-vyre/eval.json")) as { version: number; world: World; scenarios: AboutScenario[] };
const registry = JSON.parse(read("generated/registry.json")) as { $defs: Record<string, JsonSchema> };
const gen = loadGenerated();
/** What a chat lists from its first turn: the default set, plus the crew tools and the Space reads every chat preloads (modules/mcp/impl.ts). */
const chatListed = new Set([...gen.defaults, ...CREW_TOOLS, ...ABOUT_VYRE_TOOLS]);
const tools: Tools = { byName: (n) => gen.catalog.byName(n), isListed: (n) => chatListed.has(n), defs: registry.$defs };
const world: AboutWorld = { ...evalSet.world, skill: SKILL };
const scenario = (id: string): AboutScenario => { const s = evalSet.scenarios.find((x) => x.id === id); assert.ok(s, `scenario ${id}`); return structuredClone(s); };
const broken = (s: AboutScenario): string[] => [...new Set(evaluateAbout(s, world, tools).map((v) => v.rule))];
const lastSay = (s: AboutScenario): number => s.trace.length - 1 - [...s.trace].reverse().findIndex((t) => "say" in t);
const setSay = (s: AboutScenario, text: string): void => { s.trace[lastSay(s)] = { say: text }; };
const addSay = (s: AboutScenario, text: string): void => { const i = lastSay(s); s.trace[i] = { say: `${(s.trace[i] as { say: string }).say} ${text}` }; };

/** The six questions the lead asked for, word for word. */
const ASKED = [
  "What is Vyre?",
  "Can Vyre replace my Claude Code and Codex CLI for long sessions?",
  "Does Vyre support Codex?",
  "How does Vyre handle a session that runs for hours, or a crash?",
  "How do I manage a project with tasks and reviewers here?",
  "Can it work on my GitHub repo and open a PR?",
];

// ---- the set

test("the eval set asks the six questions and the owner's own two, each scenario starting from what the owner really said", () => {
  assert.equal(evalSet.version, 1);
  const prompts = evalSet.scenarios.map((s) => s.prompt);
  for (const q of [...ASKED, ...OWNER_WORDS]) assert.ok(prompts.includes(q), q);
  assert.equal(new Set(evalSet.scenarios.map((s) => s.id)).size, evalSet.scenarios.length, "ids are unique");
  for (const s of evalSet.scenarios) {
    assert.ok(OWNER_WORDS.includes(s.said), `${s.id}: said is the owner's own words`);
    assert.ok(s.trace.length > 0 && s.facts.length > 0 && s.rules.length > 0, s.id);
    for (const r of s.rules) assert.ok(r in ABOUT_RULES, `${s.id}: rule ${r}`);
  }
});

test("every scenario passes: no rule broken, every fact backed by the skill, every tool real and listed or found first", () => {
  for (const s of evalSet.scenarios) assert.deepEqual(evaluateAbout(s, world, tools), [], s.id);
});

test("together the scenarios exercise every rule", () => {
  const used = new Set(evalSet.scenarios.flatMap((s) => s.rules));
  for (const r of Object.keys(ABOUT_RULES)) assert.ok(used.has(r), `no scenario exercises ${r}`);
});

// ---- the rubric catches the answers the owner got, and the rest of what it is for

for (const s of evalSet.scenarios) {
  for (const bad of ANSWERS_HE_GOT) {
    test(`no_known_wrong catches "${bad}" in ${s.id}`, () => {
      const said = scenario(s.id);
      addSay(said, bad);
      assert.ok(broken(said).includes("no_known_wrong"), bad);
      const only = scenario(s.id);
      setSay(only, bad);
      assert.ok(broken(only).includes("no_known_wrong"), bad);
    });
  }
}

type Mutation = [id: string, rule: string, mutate: (s: AboutScenario) => void];
const calls = (s: AboutScenario) => s.trace.filter((t): t is Extract<Step, { call: string }> => "call" in t);
const mutations: Mutation[] = [
  ["codex-supported", "no_known_wrong", (s) => setSay(s, "Codex is not supported in Vyre. It runs on Claude Code and Grok.")],
  ["codex-supported", "no_known_wrong", (s) => setSay(s, "Vyre doesn't support Codex today.")],
  ["codex-supported", "connect_not_unsupported", (s) => setSay(s, "Codex, Claude Code and Grok are engines here, and Vyre installs Codex itself, but Codex is not connected, so it is not available.")],
  ["codex-supported", "checks_space", (s) => { s.trace = s.trace.filter((t) => !("call" in t)); }],
  ["owner-replacement", "checks_space", (s) => { s.trace = s.trace.filter((t) => !("call" in t)); }],
  ["github-pr", "checks_space", (s) => { s.trace = s.trace.filter((t) => !("call" in t)); }],
  ["github-pr", "tools_available", (s) => { s.trace = s.trace.filter((t) => !("call" in t) || t.call !== "tool_search"); }],
  ["github-pr", "tools_available", (s) => { (calls(s).find((c) => c.call === "engine_crew_repo_get")!.input as { projectId: string }).projectId = "Website"; }],
  ["github-pr", "names_a_limit", (s) => setSay(s, "Yes. Crew teammates work on their own branch; Merge and Push land it, and the GitHub App opens pull requests and watches checks.")],
  ["long-session-crash", "says_facts", (s) => setSay(s, "It keeps going for hours. A crash is handled.")],
  ["what-is-vyre", "says_facts", (s) => { s.facts.push("a phone app with push notifications"); addSay(s, "There is a phone app with push notifications."); }],
  ["project-tasks-reviewers", "plain_words", (s) => addSay(s, "I can set it up with task_plan and tasks_assign.")],
  ["what-is-vyre", "about_loaded", (s) => { s.prompt = "Send this to Sam."; }],
  ["owner-what-do-you-think", "no_known_wrong", (s) => setSay(s, "I don't know much about Vyre yet.")],
];

for (const [id, rule, mutate] of mutations) {
  test(`the rubric catches it: ${rule} on a changed ${id}`, () => {
    const s = scenario(id);
    assert.deepEqual(broken(s), [], "the scenario is clean before the change");
    mutate(s);
    assert.ok(broken(s).includes(rule), `${rule} should fire; got ${JSON.stringify(broken(s))}`);
  });
}

// ---- the trigger

test("the owner's words and the six questions load the skill by themselves; ordinary asks do not", () => {
  for (const said of [...OWNER_WORDS, ...ASKED, "Is Vyre better than Cursor for this?", "can this replace Jira for us", "does it work with Ollama?", "How does vyre handle context limits?"]) assert.ok(ABOUT_VYRE_INTENT.test(said), said);
  for (const said of ["what is on my calendar", "send this to Sam", "add a task to call Dana", "fix the failing test in billing.ts", "summarise this thread", "use Codex to write the parser", "open the contracts folder"]) assert.equal(ABOUT_VYRE_INTENT.test(said), false, said);
});

// ---- the skill text

test("the skill has the front matter of a system skill and stays short", () => {
  const lines = SKILL.split("\n");
  assert.match(lines[0]!, /^---$/);
  assert.match(SKILL, /^name: about-vyre$/m);
  assert.match(SKILL, /^system: true$/m);
  assert.match(SKILL, /^description: Load when someone asks about Vyre itself\..{30,240}$/m);
  assert.ok(lines.length <= 100, `${lines.length} lines`);
  assert.ok(SKILL.length < 12_000, `${SKILL.length} characters`);
});

test("the copy is plain: no backticks, no em dash, no section sign", () => {
  assert.equal(SKILL.includes("`"), false, "no backticked names in prose");
  assert.equal(SKILL.includes(String.fromCharCode(0x2014)), false, "no em dash");
  assert.equal(SKILL.includes(String.fromCharCode(0xa7)), false, "no section sign");
});

test("every tool the skill names is real, and the Space reads it leans on are listed in every chat", () => {
  const named = new Set([...SKILL.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/g)].map((m) => m[0]));
  for (const n of named) assert.ok(gen.catalog.byName(n), `${n} is in the skill but is not a tool`);
  for (const n of ABOUT_VYRE_TOOLS) {
    assert.ok(gen.catalog.byName(n), `${n} is not a tool`);
    assert.ok(named.has(n), `${n} is listed for every chat but the skill does not say to use it`);
  }
});

/** The name the skill gives each engine and provider the drivers have. A driver added without a name here fails, and so does one the skill leaves out. */
const ENGINE_NAMES: Readonly<Record<string, string>> = {
  claude_code: "Claude Code", codex: "Codex", grok: "Grok",
  anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", google: "Google", xai: "xAI", opencode_go: "OpenCode Go", local: "local model", custom: "OpenAI-compatible endpoint",
};

test("the skill names every engine and provider the drivers support, and Vyre installing the CLIs", () => {
  for (const id of [...CLI_IDS, ...API_IDS]) {
    const name = ENGINE_NAMES[id];
    assert.ok(name, `${id} has no name in this test: add it, and to the skill`);
    assert.ok(SKILL.includes(name), `the skill does not name ${name} (${id})`);
  }
  assert.match(SKILL, /Vyre installs Claude Code, Codex and Grok itself/);
  assert.match(SKILL, /Space AI key/);
});

test("the skill says what not to answer, and to check this Space", () => {
  assert.match(SKILL, /Never answer that you searched memory and found nothing about Vyre/);
  assert.match(SKILL, /Never call a supported engine or feature missing/);
  assert.match(SKILL, /^## Check this Space before you answer$/m);
  assert.match(SKILL, /^## Limits today$/m);
});
