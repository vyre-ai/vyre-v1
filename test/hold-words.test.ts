// Every capability the Gate can hold has its words (lane l-chrome2a): the registry is walked, and a capability that is held (it names a Gate act, or goes outward) with no line in lib/hold-phrases.ts fails here.
// The words must read like a person wrote them: no capability name, no module dots, no raw field names, and the title of a held act that is not a message never says message.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HOLD_PHRASES } from "../lib/hold-phrases.ts";
import { holdTitle, wantsFromInput } from "../lib/hold-words.ts";
import { outwardOf } from "../lib/outward.ts";

interface Cap {
  name: string;
  effects: string;
  gate?: { act?: string };
}
const caps = (
  JSON.parse(fs.readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Cap[] }
).capabilities;
const holdable = caps.filter((c) => (c.gate?.act !== undefined && c.gate.act !== "none") || c.effects === "outward");

test("the registry has held capabilities to cover", () => {
  assert.ok(holdable.length > 150, `${holdable.length}`);
});

test("every held capability has its own words, and nothing in the table is for a capability that does not exist", () => {
  const names = new Set(caps.map((c) => c.name));
  const missing = holdable
    .map((c) => c.name)
    .filter((n) => !HOLD_PHRASES[n] && wantsFromInput(n, { url: "https://example.com" }) === null);
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
    if (!isMessage)
      assert.ok(
        !/message/i.test(t) ||
          /(Gmail|Outlook) message|a message from|a message to/i.test(t) ||
          /message/i.test(HOLD_PHRASES[c.name] ?? ""),
        `${c.name}: ${t}`,
      );
    assert.ok(!c.name.includes(" ") && !t.includes(c.name), `${c.name}: ${t}`);
  }
  assert.equal(
    holdTitle("automations.read_link", { url: "https://www.example.com/a" }, "Send a message"),
    "Open example.com",
  );
});

test("a held change of the Space time zone says the zone in words: Pacific Time, not an id", () => {
  assert.equal(
    wantsFromInput("spaces.timezone.set", { timezone: "America/Los_Angeles" }),
    "change the Space time zone to Pacific Time",
  );
  assert.equal(
    wantsFromInput("spaces.timezone.set", { timezone: "Mars/Olympus" }),
    "change the Space time zone",
    "a zone nobody knows is not named",
  );
  assert.equal(HOLD_PHRASES["spaces.timezone.set"], "change the Space time zone");
});

test("a held read of a web page names the host, then the whole address: never cut, control and bidi characters written out, an address that is not a web address is not worded as a host", () => {
  const url = "https://docs.vendor.example/guide/auth?topic=tokens&page=2";
  assert.equal(wantsFromInput("computers.chrome.read", { url }), `read a web page on docs.vendor.example: ${url}`);
  const long = `https://a.example/${"x".repeat(1982)}?d=THE-END-OF-THE-ADDRESS`;
  assert.ok(long.length > 2000);
  const words = wantsFromInput("computers.chrome.read", { url: long })!;
  assert.ok(words.endsWith(long), "the whole address, to its last character");
  assert.ok(words.includes("THE-END-OF-THE-ADDRESS"));
  const bidi = wantsFromInput("computers.chrome.read", {
    url: "https://a.example/\u202Egpj.exe?x=1\nnewline\u200Bzero",
  })!;
  assert.ok(!/[\u202E\n\u200B]/.test(bidi), "none of them is in the text");
  assert.ok(bidi.includes("[U+202E]") && bidi.includes("[U+000A]") && bidi.includes("[U+200B]"), bidi);
  for (const bad of ["", "not a url", "ftp://x.example/", "javascript:alert(1)", "https://"])
    assert.equal(
      wantsFromInput("computers.chrome.read", { url: bad }),
      "read an address that is not a web address",
      bad,
    );
  assert.equal(HOLD_PHRASES["computers.chrome.read"], "read a web page it chose itself");
});

test("every control and format character is written out on a card: bidi marks, the Arabic letter mark, tag characters, variation selectors, separators", () => {
  const nasty = "https://a.example/p\u061Cq\u2066r\u2069s\u{E0041}t\uFE0Fu\u2028v\u{E0100}w\u00ADx\uE000y";
  const shown = wantsFromInput("computers.chrome.read", { url: nasty })!;
  assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\uFE0F\u{E0100}]/u.test(shown), "none reaches the card as itself");
  for (const code of ["061C", "2066", "2069", "E0041", "FE0F", "2028", "E0100", "00AD", "E000"])
    assert.ok(shown.includes(`[U+${code}]`), code);
  assert.ok(shown.includes("pqrs") === false && shown.includes("p[U+061C]q"), shown);
});

test("a held approval of where a key may be sent always names the host", () => {
  assert.equal(holdTitle("automations.key_hosts.allow", { itemId: "vit_1", host: "api.fathom.video" }), "Let a key be sent to api.fathom.video");
  assert.equal(holdTitle("automations.key_hosts.allow", { itemId: "vit_1", host: "https://www.Example.com/x" }).includes("example.com"), true);
  assert.equal(holdTitle("automations.key_hosts.remove", { itemId: "vit_1", host: "api.fathom.video" }), "Stop a key being sent to api.fathom.video");
  assert.match(holdTitle("automations.key_hosts.allow", {}), /another host/);
  assert.ok(holdTitle("automations.key_hosts.allow", { host: "h".repeat(300) + ".com" }).length < 120, "a long host is cut");
});

test("a host written with a user name, a port or an address in brackets is read as its host, never the part before the @", () => {
  assert.match(holdTitle("automations.key_hosts.allow", { host: "ok.com@evil.example/x" }), /evil\.example/);
  assert.ok(!holdTitle("automations.key_hosts.allow", { host: "ok.com@evil.example/x" }).includes("ok.com"));
  assert.match(holdTitle("automations.key_hosts.allow", { host: "[::1]:8080" }), /::1|\[::1\]/);
});
