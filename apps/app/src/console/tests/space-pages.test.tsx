// Console > Space: General (identity, Defaults for new members, Plan and usage), Transfer or delete. Each control is pressed by its testID; the capability and its input are read from the recorded calls.
import test from "node:test";
import assert from "node:assert/strict";
import { SpaceProfile, memberDefaults, dollars, spendLine, storageLine } from "../pages/InfrastructureSettings.tsx";
import { createdLine } from "../pages/space-created.ts";
import { SpaceDeletePage, deleteDate, deleteName } from "../pages/SpaceDelete.tsx";
import { act } from "react";
import { createRoot } from "test-renderer";
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

const blur = async (p: { find(id: string): { props: Record<string, unknown> } | null }, id: string): Promise<void> => { await act(async () => { (p.find(id)!.props["onBlur"] as (e: unknown) => void)({ target: { value: "" }, nativeEvent: {} }); }); };
const gone = (p: { has(id: string): boolean }, ids: string[]): void => { for (const id of ids) assert.equal(p.has(id), false, `${id} is gone`); };

test("General has no Save buttons: Identity rows, Defaults rows and a Details group", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample", { hostedOn: "Northwind server" }) });
  try {
    const t = p.text();
    for (const w of ["Identity", "Logo", "Name", "Legal name", "Shown on public pages and emails", "Address", "northwind.vyre.run", "Defaults for new members", "Skin", "Time zone", "Details", "Space ID", "Key fingerprint", "ab12 cd34", "Hosted on", "Northwind server", "Created"]) assert.ok(t.includes(w), w);
    gone(p, ["infra-space-save", "infra-space-defaults-save", "space-image-from-files"]);
    assert.doesNotMatch(t, /Save defaults|Choose image|Choose from Files|Space image/);
    assert.ok(t.includes("Upload") && p.has("space-image-choose"), "Upload is the logo control");
    assert.ok(t.includes("UTC"), "time zone falls back to the id when nothing is set");
    assert.doesNotMatch(t, /\bSave\b/);
  } finally { p.restore(); }
});

test("Name and Legal name save on blur with the right input, and not when unchanged or the name is empty", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample", { defaults: { other: 1 } }) });
  try {
    await blur(p, "infra-space-name");
    await blur(p, "infra-space-legal");
    assert.equal(p.called("spaces.update").length, 0, "nothing changed, nothing saved");
    await p.type("infra-space-name", "Northwind Group");
    assert.equal(p.called("spaces.update").length, 0, "typing alone does not save");
    await blur(p, "infra-space-name");
    assert.deepEqual(p.called("spaces.update").at(-1)!.input, { name: "Northwind Group" });
    assert.ok(p.text().includes("Name saved."), "a quiet confirmation");
    await p.type("infra-space-legal", "Northwind Group LLP");
    await blur(p, "infra-space-legal");
    assert.deepEqual(p.called("spaces.update").at(-1)!.input, { legalName: "Northwind Group LLP" });
    const n = p.called("spaces.update").length;
    await p.type("infra-space-name", "   ");
    await blur(p, "infra-space-name");
    assert.equal(p.called("spaces.update").length, n, "an empty name is never saved");
  } finally { p.restore(); }
});

test("Skin and Time zone save on change into the Space defaults, and not when the same one is chosen", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample", { defaults: { other: 1, timezone: "America/Los_Angeles" } }) });
  try {
    assert.ok(p.text().includes("Pacific Time, Los Angeles"), "the zone reads as a city");
    await p.press("infra-space-zone");
    await p.press("menu-item-Pacific Time, Los Angeles");
    assert.equal(p.called("spaces.update").length, 0, "the same zone is no change");
    await p.press("infra-space-zone");
    await p.press("menu-item-Eastern Time, New York");
    assert.deepEqual(p.called("spaces.update").at(-1)!.input, { defaults: { other: 1, skin: "system", timezone: "America/New_York" } });
    await p.press("infra-space-skin");
    await p.press("menu-item-Graphite");
    assert.equal((p.called("spaces.update").at(-1)!.input["defaults"] as Record<string, unknown>)["skin"], "graphite");
  } finally { p.restore(); }
});

test("a save that fails shows an error line", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample") }, (cap) => { if (cap === "spaces.update") throw Object.assign(new Error("The name is taken"), { code: "conflict" }); return {}; });
  try {
    await p.type("infra-space-name", "Taken");
    await blur(p, "infra-space-name");
    assert.ok(p.text().includes("The name is taken"), p.text());
    assert.doesNotMatch(p.text(), /Name saved/);
  } finally { p.restore(); }
});

test("Review address change confirms before spaces.switch_address", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample") });
  try {
    await p.press("infra-space-address-review");
    assert.equal(p.called("spaces.switch_address").length, 0);
    await p.press("infra-space-confirm");
    assert.deepEqual(p.called("spaces.switch_address").at(-1)!.input, { mode: "relay" });
  } finally { p.restore(); }
});

test("General shows the plan, AI spend against the Space limit and storage, and Spend and limits opens that page", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, {
    "spaces.get": SPACE("usr_sample"),
    "engine.spend.get": { caps: { monthMicros: 1_000_000_000 }, todayMicros: 0, monthMicros: 412_000_000, turnsToday: 0, paused: false },
    "console.overview": { health: "healthy", attention: [], activity: [], usage: { turnsToday: 0, costMicrosMonth: 0, members: 3, agents: 2 }, machine: { diskTotalBytes: 160 * 1024 ** 3, diskFreeBytes: 118 * 1024 ** 3 } },
  });
  try {
    const t = p.text();
    assert.ok(t.includes("Plan and usage") && t.includes("Vyre design beta") && t.includes("Contact Clearfield Labs for plans and pricing"));
    assert.ok(t.includes("$412 of $1,000") && t.includes("42 of 160 GB"));
    assert.deepEqual(p.read("engine.spend.get").at(-1)!.input, { scope: "space" });
    await p.press("space-spend-open");
    assert.deepEqual(p.opened.at(-1), { page: "spend", args: undefined });
  } finally { p.restore(); }
});

test("Make someone the Owner: pick a person, review, then spaces.transfer_ownership names them", async () => {
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE }, undefined, { me: { id: "usr_sample", name: "Me", role: "" }, name: (id: string) => id === "usr_maya" ? "Maya Chen" : id });
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
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": {} }, undefined, me);
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
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": { at: NOW - 25 * HOUR } }, undefined, me);
  try {
    await p.press("delete-open");
    assert.ok(p.text().includes("Take an export first"));
    await p.type("delete-name", "Northwind Legal LLP");
    await p.press("delete-confirm");
    assert.equal(p.called("spaces.delete").length, 0, "no export and no explicit choice yet");
  } finally { p.restore(); }
});

test("Delete without an export is its own explicit step: with it and the name, spaces.delete carries withoutExport", async () => {
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": {} }, undefined, me);
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
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_sample"), "access.principals.list": PEOPLE, "spaces.export_latest": { at: NOW - 2 * HOUR } }, undefined, me);
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
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_sample", { deletionAt: at }), "access.principals.list": PEOPLE }, undefined, me);
  try {
    assert.ok(p.text().includes("Scheduled for deletion on 18 November 2026") && p.text().includes("Everything is removed then"));
    assert.ok(!p.has("delete-open"), "nothing more to schedule");
    await p.press("deletion-cancel");
    assert.deepEqual(p.called("spaces.delete_cancel").at(-1)!.input, {});
  } finally { p.restore(); }
});

test("an admin who is not the Owner sees the scheduled deletion and can cancel it", async () => {
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_other", { deletionAt: Date.UTC(2026, 10, 18) }) }, undefined, me);
  try {
    assert.ok(p.text().includes("Scheduled for deletion on 18 November 2026"));
    await p.press("deletion-cancel");
    assert.equal(p.called("spaces.delete_cancel").length, 1);
    assert.ok(p.has("leave-open"));
  } finally { p.restore(); }
});

test("a person who is not the Owner can only leave the Space", async () => {
  const p = await mountPage(createRoot, <SpaceDeletePage />, { "spaces.get": SPACE("usr_other") }, undefined, { me: { id: "usr_sample", name: "Me", role: "" } });
  try {
    assert.ok(!p.has("transfer-choose") && !p.has("delete-open"));
    await p.press("leave-open");
    await p.press("leave-confirm");
    assert.deepEqual(p.called("spaces.leave").at(-1)!.input, { confirm: true });
  } finally { p.restore(); }
});

test("Created reads as a date and time without seconds, in the person's zone: 8 Apr 2026, 11:16", () => {
  const at = Date.UTC(2026, 3, 8, 11, 16, 42);
  assert.equal(createdLine(at, "UTC"), "8 Apr 2026, 11:16");
  assert.equal(createdLine(at, "Asia/Karachi"), "8 Apr 2026, 16:16");
  assert.equal(createdLine(Date.UTC(2026, 0, 3, 0, 5), "UTC"), "3 Jan 2026, 00:05");
  assert.equal(createdLine(new Date(at).toISOString(), "America/Los_Angeles"), "8 Apr 2026, 04:16");
  assert.equal(createdLine("nope"), "Unknown");
});

test("Details: only the Space ID and the key fingerprint are mono; Hosted on and Created are plain text", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample", { hostedOn: "Northwind server", createdAt: Date.UTC(2026, 3, 8, 11, 16, 42) }) });
  try {
    assert.match(p.text(), /Northwind server/);
    assert.match(p.text(), /\d{1,2} \w{3} 20\d\d, \d\d:\d\d(?!:)/);
    const mono = (n: { props: Record<string, unknown>; children?: unknown[] }): boolean => JSON.stringify(n.props["style"] ?? "").includes("monospace");
    assert.equal(mono(p.find("space-created-value") as never), false);
  } finally { p.restore(); }
});

test("Space time zone: pick a city, read one line of what it changes, then save with spaces.timezone.set; Cancel changes nothing", async () => {
  const p = await mountPage(createRoot, <SpaceProfile />, { "spaces.get": SPACE("usr_sample", { timezone: "Asia/Karachi" }) });
  try {
    assert.match(p.text(), /Space time zone/);
    assert.match(p.text(), /Pakistan[^,]*, Karachi/, "the button names the zone, the city and its time");
    assert.match(p.text(), /Time zone for new members/, "the member default is a different row with its own name");
    await p.press("infra-space-timezone");
    const row = Array.from({ length: 1 }, () => p.find("menu-item-Pacific Time, Los Angeles, " + new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date())))[0];
    assert.ok(row, "Los Angeles is in the list with the time there now");
    await p.press("menu-item-Pacific Time, Los Angeles, " + new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date()));
    assert.equal(p.called("spaces.timezone.set").length, 0, "choosing is not saving");
    assert.match(p.text(), /Check-ins, due times and schedules will read in Pacific Time\. Deadlines already set keep their moment\./);
    await p.press("infra-space-timezone-cancel");
    assert.equal(p.called("spaces.timezone.set").length, 0);
    assert.doesNotMatch(p.text(), /will read in Pacific Time/);
    await p.press("infra-space-timezone");
    await p.press("menu-item-Pacific Time, Los Angeles, " + new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date()));
    assert.match(p.text(), /Pakistan Time now reads .* Pacific Time\./, "a live example of this moment, before and after");
    await p.press("infra-space-timezone-save");
    assert.deepEqual(p.called("spaces.timezone.set").at(-1)!.input, { timezone: "America/Los_Angeles" });
    assert.match(p.text(), /Space time zone is now Pacific Time\./);
    assert.match(p.text(), /Recorded in the audit log: changed by you, just now\./);
    await p.press("infra-space-timezone-undo");
    assert.deepEqual(p.called("spaces.timezone.set").at(-1)!.input, { timezone: "Asia/Karachi" }, "Undo puts the old zone back");
    assert.equal(p.called("spaces.update").length, 0, "the member default is not touched");
  } finally { p.restore(); }
});
