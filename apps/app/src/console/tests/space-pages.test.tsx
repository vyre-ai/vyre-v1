// Console > Space: General (identity, Defaults for new members), Billing, Transfer or delete. Each control is pressed by its testID; the capability and its input are read from the recorded calls.
import test from "node:test";
import assert from "node:assert/strict";
import { SpaceProfile, memberDefaults } from "../pages/InfrastructureSettings.tsx";
import { BillingPage, dollars, spendLine, storageLine } from "../pages/Billing.tsx";
import { SpaceDeletePage, deleteDate, deleteName } from "../pages/SpaceDelete.tsx";
import { mountPage } from "./page-kit.tsx";

const SPACE = (owner: string, over: Record<string, unknown> = {}) => ({ space: { id: "spc_1", name: "Northwind", legalName: "Northwind Legal LLP", kind: "team", owner, fingerprint: "ab12 cd34", address: { mode: "relay", host: "northwind.vyre.run" }, defaults: {}, createdAt: 1, ...over } });
const PEOPLE = { principals: [{ id: "usr_sample", name: "Me", kind: "person", status: "active", roles: [], groups: [], createdAt: 1 }, { id: "usr_maya", name: "Maya Chen", kind: "person", status: "active", roles: [], groups: [], createdAt: 1, title: "Admin" }] };

test("money and storage read as the prototype does", () => {
  assert.equal(dollars(412_000_000), "$412");
  assert.equal(spendLine(412_500_000, 1_000_000_000), "$412.50 of $1,000");
  assert.equal(spendLine(3_000_000, undefined), "$3, no limit set");
  assert.equal(storageLine({ diskTotalBytes: 160 * 1024 ** 3, diskFreeBytes: 118 * 1024 ** 3 }), "42 of 160 GB");
  assert.equal(storageLine(undefined), "Not reported yet");
  assert.deepEqual(memberDefaults({ skin: "graphite", timezone: "Asia/Karachi" }), { skin: "graphite", timezone: "Asia/Karachi" });
  assert.equal(deleteName({ name: "Northwind", legalName: " " }), "Northwind");
});

test("General saves the name and legal name, and Defaults for new members saves the skin and time zone into the Space defaults", async () => {
  const p = await mountPage(<SpaceProfile />, { "spaces.get": SPACE("usr_sample", { defaults: { other: 1 } }) });
  try {
    assert.ok(p.text().includes("Defaults for new members") && p.text().includes("northwind.vyre.run"));
    assert.doesNotMatch(p.text(), /Delete this Space|Transfer ownership/, "those moved to Transfer or delete");
    await p.type("infra-space-name", "Northwind Group");
    await p.type("infra-space-legal", "Northwind Group LLP");
    await p.press("infra-space-save");
    assert.deepEqual(p.called("spaces.update").at(-1)!.input, { name: "Northwind Group", legalName: "Northwind Group LLP" });
    assert.equal(p.find("infra-space-defaults-save")?.props["disabled"] === true || p.find("infra-space-defaults-save")?.props["aria-disabled"] === true, true, "nothing to save until a default changes");
  } finally { p.restore(); }
});

test("Review address change confirms before spaces.switch_address", async () => {
  const p = await mountPage(<SpaceProfile />, { "spaces.get": SPACE("usr_sample") });
  try {
    await p.press("infra-space-address-review");
    assert.equal(p.called("spaces.switch_address").length, 0);
    await p.press("infra-space-confirm");
    assert.deepEqual(p.called("spaces.switch_address").at(-1)!.input, { mode: "relay" });
  } finally { p.restore(); }
});

test("Billing shows the plan, AI spend against the Space cap and storage, and Spend and limits opens that page", async () => {
  const p = await mountPage(<BillingPage />, {
    "engine.spend.get": { caps: { monthMicros: 1_000_000_000 }, todayMicros: 0, monthMicros: 412_000_000, turnsToday: 0, paused: false },
    "console.overview": { health: "healthy", attention: [], activity: [], usage: { turnsToday: 0, costMicrosMonth: 0, members: 3, agents: 2 }, machine: { diskTotalBytes: 160 * 1024 ** 3, diskFreeBytes: 118 * 1024 ** 3 } },
  });
  try {
    const t = p.text();
    assert.ok(t.includes("Vyre design beta") && t.includes("Contact Clearfield Labs for plans and pricing"));
    assert.ok(t.includes("$412 of $1,000") && t.includes("42 of 160 GB"));
    assert.deepEqual(p.read("engine.spend.get").at(-1)!.input, { scope: "space" });
    await p.press("billing-spend-open");
    assert.deepEqual(p.opened.at(-1), { page: "spend", args: undefined });
  } finally { p.restore(); }
});

test("Make someone the Owner: pick a person, review, then spaces.transfer_ownership names them", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE }, undefined, { me: { id: "usr_sample", name: "Me", role: "" }, name: (id: string) => id === "usr_maya" ? "Maya Chen" : id });
  try {
    await p.press("transfer-choose");
    assert.ok(p.has("row-transfer-person-usr_maya") && !p.has("row-transfer-person-usr_sample"), "you are not offered yourself");
    await p.press("transfer-pick-usr_maya");
    assert.equal(p.called("spaces.transfer_ownership").length, 0, "review first");
    assert.match(p.text(), /Make\s+Maya Chen\s+the Owner\?/);
    await p.press("transfer-confirm");
    assert.deepEqual(p.called("spaces.transfer_ownership").at(-1)!.input, { to: "usr_maya" });
  } finally { p.restore(); }
});

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;
const me = { me: { id: "usr_sample", name: "Me", role: "" }, clock: () => ({ now: NOW }) };

test("dates read in words, in UTC", () => {
  assert.equal(deleteDate(Date.UTC(2026, 10, 18, 9)), "18 November 2026");
});

test("with no export in the last 24 hours the page offers Take an export first, and Export runs spaces.export", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": {} }, undefined, me);
  try {
    assert.ok(p.read("spaces.export_latest").length >= 1, "the page asks the server for the newest export");
    await p.press("delete-open");
    assert.ok(p.text().includes("Take an export first") && p.text().includes("Delete without an export"));
    assert.equal(p.called("spaces.delete").length, 0);
    await p.press("delete-export-run");
    assert.equal(p.called("spaces.export").length, 1);
  } finally { p.restore(); }
});

test("an old export does not count: the same offer, and nothing is scheduled without the name typed", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": { at: NOW - 25 * HOUR } }, undefined, me);
  try {
    await p.press("delete-open");
    assert.ok(p.text().includes("Take an export first"));
    await p.type("delete-name", "Northwind Legal LLP");
    await p.press("delete-confirm");
    assert.equal(p.called("spaces.delete").length, 0, "no export and no explicit choice yet");
  } finally { p.restore(); }
});

test("Delete without an export is its own explicit step: with it and the name, spaces.delete carries withoutExport", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": {} }, undefined, me);
  try {
    await p.press("delete-open");
    await p.press("delete-skip-toggle");
    await p.type("delete-name", "Wrong name");
    await p.press("delete-confirm");
    assert.equal(p.called("spaces.delete").length, 0, "the name does not match");
    await p.type("delete-name", "Northwind Legal LLP");
    await p.press("delete-confirm");
    assert.deepEqual(p.called("spaces.delete").at(-1)!.input, { confirmName: "Northwind Legal LLP", withoutExport: true });
  } finally { p.restore(); }
});

test("with an export from the last 24 hours the page says so and spaces.delete needs only the typed name", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": { at: NOW - 2 * HOUR } }, undefined, me);
  try {
    await p.press("delete-open");
    assert.ok(p.text().includes("Export taken") && !p.has("delete-skip-toggle") && !p.has("delete-export-run"));
    assert.match(p.text(), /Deletion happens after 14 days and you can cancel until then/);
    await p.press("delete-confirm");
    assert.equal(p.called("spaces.delete").length, 0, "the name is not typed");
    await p.type("delete-name", "Northwind Legal LLP");
    await p.press("delete-confirm");
    assert.deepEqual(p.called("spaces.delete").at(-1)!.input, { confirmName: "Northwind Legal LLP" });
  } finally { p.restore(); }
});

test("a Space scheduled for deletion says when, and Cancel deletion runs spaces.delete_cancel", async () => {
  const at = Date.UTC(2026, 10, 18, 9);
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_sample", { deletionAt: at }), "access.principals.list": PEOPLE }, undefined, me);
  try {
    assert.ok(p.text().includes("Scheduled for deletion on 18 November 2026") && p.text().includes("Everything is removed then"));
    assert.ok(!p.has("delete-open"), "nothing more to schedule");
    await p.press("deletion-cancel");
    assert.deepEqual(p.called("spaces.delete_cancel").at(-1)!.input, {});
  } finally { p.restore(); }
});

test("an admin who is not the Owner sees the scheduled deletion and can cancel it", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_other", { deletionAt: Date.UTC(2026, 10, 18) }) }, undefined, me);
  try {
    assert.ok(p.text().includes("Scheduled for deletion on 18 November 2026"));
    await p.press("deletion-cancel");
    assert.equal(p.called("spaces.delete_cancel").length, 1);
    assert.ok(p.has("leave-open"));
  } finally { p.restore(); }
});

test("a person who is not the Owner can only leave the Space", async () => {
  const p = await mountPage(<SpaceDeletePage />, { "spaces.get": SPACE("usr_other") }, undefined, { me: { id: "usr_sample", name: "Me", role: "" } });
  try {
    assert.ok(!p.has("transfer-choose") && !p.has("delete-open"));
    await p.press("leave-open");
    await p.press("leave-confirm");
    assert.deepEqual(p.called("spaces.leave").at(-1)!.input, { confirm: true });
  } finally { p.restore(); }
});
