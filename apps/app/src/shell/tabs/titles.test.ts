// A tab on an item is named for the item.
import test from "node:test";
import assert from "node:assert/strict";
import { recordTitle, titleAsk, typeTitleAsk } from "./titles.ts";

test("each kind of item names its tab from the read that knows it", () => {
  assert.deepEqual(titleAsk({ type: "automation", id: "aut_1" })?.input, { automationId: "aut_1" });
  assert.equal(titleAsk({ type: "automation", id: "a" })?.name({ automation: { name: "Weekly digest" } }), "Weekly digest");
  assert.deepEqual(titleAsk({ type: "record", id: "r1" }, { type: "contact" })?.input, { type: "contact", recordId: "r1" }, "a record is read by its type and id");
  assert.equal(titleAsk({ type: "record", id: "r" }), null, "a record with no type in its hash keeps the place name");
  assert.equal(titleAsk({ type: "record", id: "r" }, { type: "contact" })?.name({ record: { fields: { name: "Elena Rivera", email: "e@x" } } }), "Elena Rivera");
  assert.equal(titleAsk({ type: "file", id: "f" })?.name({ file: { name: "Okafor medical summary.md" } }), "Okafor medical summary.md");
  assert.equal(titleAsk({ type: "task", id: "t" })?.name({ task: { title: "Send the retainer" } }), "Send the retainer");
  assert.equal(titleAsk({ type: "chat", id: "c" })?.name({ thread: { title: "Weekly pipeline summary" } }), "Weekly pipeline summary");
  assert.equal(titleAsk({ type: "unknown", id: "x" }), null, "a subject with no name to read keeps the place's name");
  assert.equal(titleAsk({ type: "automation", id: "a" })?.name({ automation: {} }), null, "no name yet: the place's name stays");
});

test("a record is named by its name, else its title, else its first text", () => {
  assert.equal(recordTitle({ title: "Rivera retainer", name: "" }), "Rivera retainer");
  assert.equal(recordTitle({ count: 3, note: "First note" }), "First note");
  assert.equal(recordTitle(null), null);
});

test("a Records tab on a type is named for the type: its plural, else its title; other places and no type keep the place name", () => {
  const ask = typeTitleAsk("records", { type: "company" })!;
  assert.equal(ask.cap, "schema.types.list");
  assert.equal(ask.name({ types: [{ key: "contact", plural: "Contacts", title: "Contact" }, { key: "company", plural: "Companies", title: "Company" }] }), "Companies");
  assert.equal(ask.name({ types: [{ key: "company", title: "Company" }] }), "Company");
  assert.equal(ask.name({ types: [] }), null);
  assert.equal(typeTitleAsk("files", { type: "company" }), null);
  assert.equal(typeTitleAsk("records", {}), null);
});
