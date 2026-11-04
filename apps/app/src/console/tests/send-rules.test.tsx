// Console > Messaging > Rules: how sending works, the always-on rules, the sending limits (settings.get and settings.set_space), and the Do-not-contact list (contacts.suppression.*).
import test from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_ON, LIMITS, SendRulesPage, optionKey } from "../pages/SendRules.tsx";
import { DncPage, parseAddresses } from "../pages/Dnc.tsx";
import { addLabel, parseDncFile, groupCsv, reasonOf } from "../pages/dnc-import-model.ts";
import { createRoot } from "test-renderer";
import { mountPage } from "./page-kit.tsx";

const row = (key: string, value: unknown) => ({ row: { key, scope: "space", page: "email", title: key, value, default: value, source: "default", floorable: false } });
const WORDS = /\b(suppression|principal|grant|actor|schema|gate|retention|tenant|sandbox)s?\b|!|successfully/i;

test("How sending works says every sender goes through the same API and lists the three rules that are always on", async () => {
  const p = await mountPage(createRoot, <SendRulesPage />, {}, () => { throw new Error("none"); });
  try {
    const t = p.text();
    assert.ok(t.includes("How sending works") && t.includes("Every sender goes through the same API"));
    for (const r of ALWAYS_ON) assert.ok(t.includes(r.title), r.title);
    assert.doesNotMatch(t, WORDS);
    assert.equal(optionKey(500), "500");
  } finally { p.restore(); }
});

test("the daily limit, sending window and speed read their setting and save a choice with settings.set_space", async () => {
  const p = await mountPage(createRoot, <SendRulesPage />, {}, (cap, input) => cap === "settings.get" ? row(String(input["key"]), input["key"] === "send.window" ? "8-20" : input["key"] === "send.cap" ? 500 : 20) : { ok: true });
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

test("a limit that cannot be read says so with a retry, never 'Not adjustable yet'", async () => {
  const p = await mountPage(createRoot, <SendRulesPage />, {}, (cap) => { if (cap === "settings.get") throw new Error("unknown setting"); return { ok: true }; });
  try {
    assert.doesNotMatch(p.text(), /Not adjustable yet/);
    assert.ok(!p.has("seg-send.cap:2000"));
    assert.equal(p.called("settings.set_space").length, 0);
  } finally { p.restore(); }
});

test("the page states what each limit does and shows the stored choice", async () => {
  const p = await mountPage(createRoot, <SendRulesPage />, {}, (cap, input) => cap === "settings.get" ? row(String(input["key"]), input["key"] === "send.window" ? "9-17" : input["key"] === "send.cap" ? 100 : 5) : { ok: true });
  try {
    const t = p.text();
    assert.ok(t.includes("Daily limit") && t.includes("100 a day") && t.includes("9:00 to 17:00") && t.includes("5 a minute"));
    assert.doesNotMatch(t, /Not adjustable yet/);
  } finally { p.restore(); }
});

test("pasted text becomes addresses: emails and phone numbers apart, no repeats", () => {
  assert.deepEqual(parseAddresses("a@x.com\n+1 555 123 4567, b@y.com; A@X.com"), { email: ["a@x.com", "b@y.com"], sms: ["+1 555 123 4567"] });
  assert.deepEqual(parseAddresses("  \n "), { email: [], sms: [] });
});

const ENTRY = (id: string, address: string, channel = "email", reason = "unsubscribe") => ({ id, channel, address, reason, source: "reply", addedAt: 1_700_000_000_000, addedBy: "usr_sample" });
const LIST = { "contacts.suppression.list": { rows: [ENTRY("sup_1", "ada@x.com"), ENTRY("sup_2", "+15551234567", "sms", "stop")] } };

test("the list shows who is on it with channel and reason, and a search narrows it through the list call", async () => {
  const p = await mountPage(createRoot, <DncPage />, LIST);
  try {
    const t = p.text();
    assert.ok(t.includes("Do-not-contact list") && t.includes("ada@x.com") && t.includes("Unsubscribed") && t.includes("Text") && t.includes("STOP"));
    assert.doesNotMatch(t, WORDS);
    await p.type("dnc-search", "ada");
    assert.deepEqual(p.read("contacts.suppression.list").at(-1)!.input, { query: "ada", limit: 100 });
  } finally { p.restore(); }
});

test("Add takes one address or a pasted list and adds each channel with the reason chosen", async () => {
  const p = await mountPage(createRoot, <DncPage />, LIST);
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
  const p = await mountPage(createRoot, <DncPage />, LIST);
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
  const p = await mountPage(createRoot, <DncPage />, { "contacts.suppression.list": { rows: [] } });
  try { assert.ok(p.text().includes("Nobody is on the list")); } finally { p.restore(); }
});

// ---- Add from a file

const csvFile = (text: string, name = "people.csv") => ({ name, mime: "text/csv", file: new File([text], name, { type: "text/csv" }) });
const FILES = { "files.tree": { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] }, "files.list": { files: [], folders: [{ folderId: "fld_imports", name: "Do-not-contact imports" }] } };
const filesAnswer = (cap: string, input: Record<string, unknown>) => {
  if (cap === "files.create") return { file: { fileId: `fil_${String(input["name"]).slice(0, 6)}` } };
  if (cap === "contacts.suppression.import") return { added: 2, skipped: 1 };
  return { ok: true };
};

test("the file reader takes one column, an optional header and an optional reason column, and counts people once", () => {
  const f = parseDncFile("email,reason\nAda@x.com,Unsubscribed\nada@x.com,\n+1 555 123 4567,stop\nnot an address,\nbo@y.com,\n", "do_not_contact");
  assert.deepEqual([f.total, f.emails, f.phones, f.skipped], [3, 2, 1, 2]);
  assert.deepEqual(f.groups.map((g) => [g.channel, g.reason, g.addresses]), [["email", "unsubscribe", ["ada@x.com"]], ["sms", "stop", ["+1 555 123 4567"]], ["email", "do_not_contact", ["bo@y.com"]]]);
  assert.equal(groupCsv(f.groups[0]!), "email\nada@x.com\n");
  assert.equal(parseDncFile("a@x.com\nb@x.com", "stop").groups[0]!.reason, "stop", "no header, no reason column: the chosen reason");
  assert.equal(reasonOf("Do not contact"), "do_not_contact");
  assert.equal(addLabel(214), "Add 214 people to the do-not-contact list");
  assert.equal(addLabel(1), "Add 1 person to the do-not-contact list");
});

test("Add from a file shows how many people it will add, and nothing is sent until the person confirms", async () => {
  const list = Array.from({ length: 214 }, (_, i) => `person${i}@x.com`).join("\n");
  const p = await mountPage(createRoot, <DncPage pick={async () => [csvFile(`email\n${list}\n`)]} />, { ...LIST, ...FILES }, filesAnswer);
  try {
    await p.press("dnc-file-open");
    assert.ok(p.text().includes("Add 214 people to the do-not-contact list") && p.text().includes("214 emails"));
    assert.doesNotMatch(p.text(), /\b(suppression)s?\b/i);
    assert.equal(p.called("contacts.suppression.import").length, 0);
    assert.equal(p.called("files.create").length, 0);
    await p.press("dnc-file-cancel");
    assert.ok(!p.has("dnc-file-form"));
  } finally { p.restore(); }
});

test("confirming stores one file per channel and reason and calls contacts.suppression.import with the reason chosen", async () => {
  const p = await mountPage(createRoot, <DncPage pick={async () => [csvFile("email,reason\na@x.com,\nb@x.com,unsubscribe\n+1 555 000 1111,\n")]} />, { ...LIST, ...FILES }, filesAnswer);
  try {
    await p.press("dnc-file-open");
    await p.press("seg-stop");   // the reason for rows that name none
    assert.ok(p.text().includes("Add 3 people to the do-not-contact list"));
    await p.press("dnc-file-confirm");
    const imports = p.called("contacts.suppression.import").map((c) => [c.input["channel"], c.input["reason"], typeof c.input["fileId"], typeof c.input["idempotencyKey"]]);
    assert.deepEqual(imports, [["email", "stop", "string", "string"], ["email", "unsubscribe", "string", "string"], ["sms", "stop", "string", "string"]]);
    const made = p.called("files.create");
    assert.equal(made.length, 3);
    assert.deepEqual(made[0]!.input["content"], { text: "email\na@x.com\n" });
    assert.equal(made[0]!.input["folderId"], "fld_imports");
    assert.ok(p.text().includes("Added 6 people to the do-not-contact list."));
  } finally { p.restore(); }
});

test("a file with no address in it says so and offers nothing to confirm", async () => {
  const p = await mountPage(createRoot, <DncPage pick={async () => [csvFile("name\nAda\nBo\n")]} />, { ...LIST, ...FILES }, filesAnswer);
  try {
    await p.press("dnc-file-open");
    assert.ok(p.text().includes("No email addresses or phone numbers in that file"));
    assert.ok(!p.has("dnc-file-confirm"));
    assert.equal(p.called("contacts.suppression.import").length, 0);
  } finally { p.restore(); }
});
