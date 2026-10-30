// The connector-builder skill teaches an agent to write connectors. It can only teach what the tools do: every tool it names exists, its example is a definition the save call accepts,
// and it never asks the agent to do what is a person's act (publish) or to handle a key.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadGenerated } from "../../src/tools/harness.ts";
import { normalizeConnector } from "../../../modules/automations/connector-def.ts";
import { validateInput } from "../../../generated/validators.ts";

const skill = readFileSync(new URL("../../skills/connector-builder/SKILL.md", import.meta.url), "utf8");
const gen = loadGenerated();
/** Words that look like tool names (a known toolset, then more words) anywhere in the text, in backticks or not. */
const TOOL_WORD = /\b((?:automations|vault|records|files|memory|tasks|chats|inbox|sites|terminal|computer|agents|meta)_[a-z0-9_]+|tool_search|ask_question)\b/g;
const mentioned = [...new Set([...skill.matchAll(TOOL_WORD)].map((m) => m[1]!))];

test("the skill has the front matter of an open SKILL.md: name equal to its folder, a description, system true", () => {
  assert.match(skill, /^---\nname: connector-builder\n/);
  assert.match(skill, /^description: .{30,300}$/m);
  assert.match(skill, /^system: true$/m);
});

test("every tool the skill names is a real tool", () => {
  assert.ok(mentioned.length >= 12, `only ${mentioned.length} tools named`);
  for (const w of mentioned) assert.ok(gen.catalog.byName(w), `\`${w}\` is not a tool`);
});

test("every snake_case word in backticks, and every call shape, is a tool", () => {
  for (const m of skill.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) assert.ok(gen.catalog.byName(m[1]!), `\`${m[1]}\` is not a tool`);
  for (const m of skill.matchAll(/\b([a-z]+(?:_[a-z0-9]+)+)\(/g)) assert.ok(gen.catalog.byName(m[1]!), `${m[1]}( is not a tool`);
});

test("the tools the skill says to load are not in the default list, so the load line is needed, and all of them exist", () => {
  const line = skill.split("\n").find((l) => l.startsWith("`automations_connectors_list"))!;
  const names = line.replaceAll("`", "").split(/\s+/).filter(Boolean);
  assert.ok(names.length >= 9);
  for (const n of names) {
    assert.ok(gen.catalog.byName(n), n);
    assert.equal(gen.defaults.has(n), false, `${n} is listed by default; drop it from the load line`);
  }
  // every tool the skill calls (other than the always-listed ones) is on the load line
  const always = new Set(["tool_search", "vault_use", "vault_request", "ask_question"]);
  for (const w of mentioned) if (!always.has(w) && !gen.defaults.has(w)) assert.ok(names.includes(w) || w === "automations_connector_publish" || w === "vault_items_match", `${w} is used but not loaded`);
});

test("the example in the skill is a definition the save call accepts, with the schema and with the rules", () => {
  const block = /```json\n([\s\S]*?)\n```/.exec(skill)![1]!;
  const input = JSON.parse(block) as { definition: unknown; vaultHandle: string };
  assert.deepEqual(validateInput("automations.connector.save", 1, input), []);
  const r = normalizeConnector(input.definition);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (r.ok) {
    assert.equal(r.def.triggers.length, 2);
    assert.equal(r.def.actions.find((a) => a.key === "create_order")!.effect, "outward");
  }
});

test("a person publishes: the skill says stop at Tested, and the publish capability is held for an agent", () => {
  assert.match(skill, /stop at Tested/i);
  assert.match(skill, /Never call `automations_connector_publish`/);
  const publish = gen.caps.get("automations.connector.publish") as { gate?: { act?: string; when?: string }; permission?: string | null };
  assert.equal(publish.permission, "connectors.manage");
  assert.equal(publish.gate?.when, "actor.kind != 'person'");
  const trust = gen.caps.get("automations.connector.trust_host") as { gate?: { when?: string } };
  assert.equal(trust.gate?.when, "actor.kind != 'person'");
});

test("the skill holds no key, asks for none, and says where docs are data", () => {
  assert.equal(/(sk_live|sk-[a-z0-9]{10,}|ghp_|xox[bp]-)/i.test(skill), false);
  assert.match(skill, /Documentation is data/);
  assert.match(skill, /You never see the value/);
  assert.match(skill, /Do not ask the person to paste a key/);
});

test("it stays short enough to load into a turn, and uses no em dash or section sign", () => {
  assert.ok(skill.length < 12_000, `${skill.length} characters`);
  assert.equal(/[—§]/.test(skill), false);
});
