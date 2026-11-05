// Every capability the Gate can hold has its words (lane l-chrome2a): the registry is walked, and a capability that is held (it names a Gate act, or goes outward) with no line in lib/hold-phrases.ts fails here.
// The words must read like a person wrote them: no capability name, no module dots, no raw field names, and the title of a held act that is not a message never says message.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HOLD_PHRASES } from "../lib/hold-phrases.ts";
import { holdTitle, wantsFromInput } from "../lib/hold-words.ts";
import { outwardOf } from "../lib/outward.ts";

interface Cap { name: string; effects: string; gate?: { act?: string } }
const caps = (JSON.parse(fs.readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Cap[] }).capabilities;
const holdable = caps.filter((c) => (c.gate?.act !== undefined && c.gate.act !== "none") || c.effects === "outward");

test("the registry has held capabilities to cover", () => {
  assert.ok(holdable.length > 150, `${holdable.length}`);
});

test("every held capability has its own words, and nothing in the table is for a capability that does not exist", () => {
  const names = new Set(caps.map((c) => c.name));
  const missing = holdable.map((c) => c.name).filter((n) => !HOLD_PHRASES[n] && wantsFromInput(n, { url: "https://example.com" }) === null);
  assert.deepEqual(missing, [], `held capabilities with no words in lib/hold-phrases.ts: ${missing.join(", ")}`);
  const stale = Object.keys(HOLD_PHRASES).filter((n) => !names.has(n));
  assert.deepEqual(stale, [], `words for capabilities that are gone: ${stale.join(", ")}`);
});

test("the words read like a person wrote them", () => {
  for (const c of holdable) {
    const words = HOLD_PHRASES[c.name];
    assert.ok(words, `${c.name} has a line in the table`);
    assert.match(words!, /^[a-z]+( [a-zA-Z'0-9-]+)+$/, `${c.name}: ${words}`);
    assert.ok(!/\b[a-z]+\.[a-z_]+\b/.test(words!), `${c.name} shows a name: ${words}`);
    assert.ok(!/(capability|module|payload|_|input)/i.test(words!), `${c.name}: ${words}`);
    assert.ok(words!.split(" ").length <= 9, `${c.name} is long: ${words}`);
  }
});

test("a title says message only for a message", () => {
  for (const c of holdable) {
    const t = holdTitle(c.name, {}, "Send a message");
    const isMessage = outwardOf(c.name, { to: "x", body: "y", text: "y", subject: "s", threadId: "t" }) !== null;
    if (!isMessage) assert.ok(!/message/i.test(t) || /(Gmail|Outlook) message|a message from|a message to/i.test(t) || /message/i.test(HOLD_PHRASES[c.name] ?? ""), `${c.name}: ${t}`);
    assert.ok(!c.name.includes(" ") && !t.includes(c.name), `${c.name}: ${t}`);
  }
  assert.equal(holdTitle("automations.read_link", { url: "https://www.example.com/a" }, "Send a message"), "Open example.com");
});

test("a held change of the Space time zone says the zone in words: Pacific Time, not an id", () => {
  assert.equal(wantsFromInput("spaces.timezone.set", { timezone: "America/Los_Angeles" }), "change the Space time zone to Pacific Time");
  assert.equal(wantsFromInput("spaces.timezone.set", { timezone: "Mars/Olympus" }), "change the Space time zone", "a zone nobody knows is not named");
  assert.equal(HOLD_PHRASES["spaces.timezone.set"], "change the Space time zone");
});
