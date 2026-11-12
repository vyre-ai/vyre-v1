// The one list of what a stranger's words, carried in by an Automation's outside-started Run, may not do without a yes (lib/automation-content.ts), and the one trigger list: every name is a real
// capability that changes something, has words a person wrote for its card, and every declared trigger but schedule, manual and button counts as outside (lead 12 Nov, runs-as review pass 3).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HELD_FROM_AUTOMATION_CONTENT, INTERNAL_TRIGGERS, isOutsideTrigger, triggerWords } from "../lib/automation-content.ts";
import { HOLD_PHRASES } from "../lib/hold-phrases.ts";

const registry = JSON.parse(fs.readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Array<{ name: string; effects: string }>; triggers?: Array<{ key: string }> };
const caps = new Map(registry.capabilities.map((c) => [c.name, c]));

test("every capability held from Automation content exists, changes something, and has its own words for the card", () => {
  assert.equal(new Set(HELD_FROM_AUTOMATION_CONTENT).size, HELD_FROM_AUTOMATION_CONTENT.length, "no name twice");
  for (const name of HELD_FROM_AUTOMATION_CONTENT) {
    const c = caps.get(name);
    assert.ok(c, `${name} is a capability (a rename would drop it from the hold)`);
    assert.notEqual(c.effects, "read", `${name} changes something`);
    const words = HOLD_PHRASES[name];
    assert.ok(words, `${name} has words in lib/hold-phrases.ts`);
    assert.match(words, /^[a-z]+( [a-zA-Z'0-9-]+)+$/, `${name}: ${words}`);
    assert.equal(words.includes("."), false, `${name}: no capability name on a card`);
  }
});

test("every declared trigger but schedule, manual and button is from outside, with plain words; an unknown or new one is outside too", () => {
  const keys = [...fs.readFileSync(new URL("../manifests/automations.ts", import.meta.url), "utf8").matchAll(/trigger\('([a-z_]+)'/g)].map((m) => m[1]!);
  assert.ok(keys.length >= 13, `${keys.length}`);
  for (const k of INTERNAL_TRIGGERS) assert.ok(keys.includes(k), `${k} is a trigger`);
  for (const k of keys) {
    assert.equal(isOutsideTrigger(k), !INTERNAL_TRIGGERS.has(k), k);
    if (isOutsideTrigger(k)) assert.notEqual(triggerWords(k), "outside trigger", `${k} has its own words`);
  }
  assert.equal(isOutsideTrigger("a_trigger_added_later"), true);
  assert.equal(isOutsideTrigger(undefined), true, "unknown counts as outside");
});
