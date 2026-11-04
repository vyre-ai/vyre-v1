// Console > Messaging > Rules: how sending works, the always-on rules, the sending limits (settings.get and settings.set_space), and the Do-not-contact list (contacts.suppression.*).
import test from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_ON, LIMITS, SendRulesPage, optionKey } from "../pages/SendRules.tsx";
import { DncPage, parseAddresses } from "../pages/Dnc.tsx";
import { mountPage } from "./page-kit.tsx";

const row = (key: string, value: unknown) => ({ row: { key, scope: "space", page: "email", title: key, value, default: value, source: "default", floorable: false } });
const WORDS = /\b(suppression|principal|grant|actor|schema|gate|retention|tenant|sandbox)s?\b|!|successfully/i;

test("How sending works says every sender goes through the same API and lists the three rules that are always on", async () => {
  const p = await mountPage(<SendRulesPage />, {}, () => { throw new Error("none"); });
  try {
    const t = p.text();
    assert.ok(t.includes("How sending works") && t.includes("Every sender goes through the same API"));
    for (const r of ALWAYS_ON) assert.ok(t.includes(r.title), r.title);
    assert.doesNotMatch(t, WORDS);
    assert.equal(optionKey(500), "500");
  } finally { p.restore(); }
});

test("the daily limit, sending window and speed read their setting and save a choice with settings.set_space", async () => {
  const p = await mountPage(<SendRulesPage />, {}, (cap, input) => cap === "settings.get" ? row(String(input["key"]), input["key"] === "send.window" ? "8-20" : input["key"] === "send.cap" ? 500 : 20) : { ok: true });
  try {
    assert.deepEqual(p.called("settings.get").map((c) => c.input["key"]).sort(), ["send.cap", "send.throttle", "send.window"]);
    await p.press("seg-send.cap:2000");
    assert.deepEqual(p.called("settings.set_space").at(-1)!.input, { key: "send.cap", value: 2000 });
    await p.press("seg-send.window:9-17");
    assert.deepEqual(p.called("settings.set_space").at(-1)!.input, { key: "send.window", value: "9-17" });
    await p.press("seg-send.throttle:60");
    assert.deepEqual(p.called("settings.set_space").at(-1)!.input, { key: "send.throttle", value: 60 });
    assert.equal(LIMITS.length, 3);
  } finally { p.restore(); }
});

test("a server that has not registered the limits shows them read-only and says so", async () => {
  const p = await mountPage(<SendRulesPage />, {}, (cap) => { if (cap === "settings.get") throw new Error("unknown setting"); return { ok: true }; });
  try {
    assert.equal((p.text().match(/Not adjustable yet/g) ?? []).length, 3);
    assert.ok(!p.has("seg-send.cap:2000"));
    assert.equal(p.called("settings.set_space").length, 0);
  } finally { p.restore(); }
});

test("pasted text becomes addresses: emails and phone numbers apart, no repeats", () => {
  assert.deepEqual(parseAddresses("a@x.com\n+1 555 123 4567, b@y.com; A@X.com"), { email: ["a@x.com", "b@y.com"], sms: ["+1 555 123 4567"] });
  assert.deepEqual(parseAddresses("  \n "), { email: [], sms: [] });
});

const ENTRY = (id: string, address: string, channel = "email", reason = "unsubscribe") => ({ id, channel, address, reason, source: "reply", addedAt: 1_700_000_000_000, addedBy: "usr_sample" });
const LIST = { "contacts.suppression.list": { rows: [ENTRY("sup_1", "ada@x.com"), ENTRY("sup_2", "+15551234567", "sms", "stop")] } };

test("the list shows who is on it with channel and reason, and a search narrows it through the list call", async () => {
  const p = await mountPage(<DncPage />, LIST);
  try {
    const t = p.text();
    assert.ok(t.includes("Do-not-contact list") && t.includes("ada@x.com") && t.includes("Unsubscribed") && t.includes("Text") && t.includes("STOP"));
    assert.doesNotMatch(t, WORDS);
    await p.type("dnc-search", "ada");
    assert.deepEqual(p.read("contacts.suppression.list").at(-1)!.input, { query: "ada", limit: 100 });
  } finally { p.restore(); }
});

test("Add takes one address or a pasted list and adds each channel with the reason chosen", async () => {
  const p = await mountPage(<DncPage />, LIST);
  try {
    await p.press("dnc-add-open");
    await p.press("dnc-add-save");
    assert.equal(p.called("contacts.suppression.add").length, 0);
    assert.ok(p.text().includes("Enter an email or a phone number."));
    await p.type("dnc-add-text", "new@x.com\n+1 555 000 1111\nother@x.com");
    await p.press("seg-stop");
    await p.press("dnc-add-save");
    const adds = p.called("contacts.suppression.add").map((c) => c.input);
    assert.deepEqual(adds, [{ channel: "email", addresses: ["new@x.com", "other@x.com"], reason: "stop" }, { channel: "sms", addresses: ["+1 555 000 1111"], reason: "stop" }]);
  } finally { p.restore(); }
});

test("Remove needs a reason and sends it with the entry to contacts.suppression.remove", async () => {
  const p = await mountPage(<DncPage />, LIST);
  try {
    await p.press("dnc-remove-sup_1");
    assert.match(p.text(), /Remove\s+ada@x\.com\s*\?/);
    await p.press("dnc-remove-confirm");
    assert.equal(p.called("contacts.suppression.remove").length, 0, "no reason, no call");
    await p.type("dnc-remove-reason", "Asked to opt in again by phone");
    await p.press("dnc-remove-confirm");
    assert.deepEqual(p.called("contacts.suppression.remove").at(-1)!.input, { suppressionId: "sup_1", note: "Asked to opt in again by phone" });
  } finally { p.restore(); }
});

test("an empty list says nobody is on it", async () => {
  const p = await mountPage(<DncPage />, { "contacts.suppression.list": { rows: [] } });
  try { assert.ok(p.text().includes("Nobody is on the list")); } finally { p.restore(); }
});
