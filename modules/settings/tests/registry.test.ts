// Settings through the real handlers (spec 3.9, ARCH 7.9): every SettingDef is listed, found by search and changeable; changes save as they are made with the previous value for Undo;
// the Space's values and the owner floor; Copy from another Space; the Kit choice. The handlers run against the module's own migration in the in-memory SQL engine.
// contract tests for the registry: every SettingDef is searchable; a value the schema refuses is refused with a sentence.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { PAGES, defs, pageOf, search } from "../projections.ts";

const MAYA = "usr_maya";
const OMAR = "usr_omar";
const names = (h: Harness) => h.events.map((e) => e.name);
const asMaya = (h: Harness) => h.as(MAYA);
const adminOmar = (h: Harness) => h.as(OMAR, { admin: true });

test("the registry has a SettingDef for every row the ten pages show, and pages counts them", async () => {
  const h = harness();
  const out = await handlers["settings.pages"](asMaya(h), {});
  assert.deepEqual(out.pages.map((p) => p.title), ["Profile", "Notifications", "Models and usage", "Connections", "Memory and privacy", "Sign-in and devices", "Appearance", "Keyboard", "This computer", "Spaces"]);
  assert.deepEqual(out.pages.map((p) => p.group), ["space", "space", "space", "space", "space", "everywhere", "everywhere", "everywhere", "everywhere", "everywhere"]);
  const total = out.pages.reduce((n, p) => n + p.rows, 0);
  assert.equal(total, defs.filter((d) => pageOf(d) !== null).length);
  assert.ok(out.pages.find((p) => p.key === "profile")!.rows >= 7);
  assert.equal(out.pages.find((p) => p.key === "computer")!.rows, 7);
});

test("every SettingDef that has a Settings page is listed under it and is found by Cmd-F", async () => {
  const h = harness();
  const all = await handlers["settings.list"](asMaya(h), {});
  const shown = defs.filter((d) => pageOf(d) !== null);
  assert.deepEqual(all.rows.map((r) => r.key).sort(), shown.map((d) => d.key).sort());
  for (const d of shown) {
    const hit = (await handlers["settings.search"](asMaya(h), { q: d.title })).rows.find((r) => r.key === d.key);
    assert.ok(hit, `${d.key} is found by its title`);
    assert.equal(hit.page, pageOf(d));
    assert.equal(hit.title, d.title);
  }
});

test("Space settings that belong to the Console are not on the ten pages but can be listed by name", async () => {
  const h = harness();
  const some = defs.find((d) => d.scope === "space" && pageOf(d) === null)!;
  assert.ok(some, "the registry has Console rows");
  const all = (await handlers["settings.list"](asMaya(h), {})).rows;
  assert.ok(!all.some((r) => r.key === some.key));
  const asked = (await handlers["settings.list"](asMaya(h), { scope: "space", page: some.page })).rows;
  assert.ok(asked.some((r) => r.key === some.key));
  assert.ok(!(await handlers["settings.search"](asMaya(h), { q: some.title })).rows.some((r) => r.key === some.key), "Cmd-F in the app does not offer Console rows");
});

test("search takes words in any order, ranks a title that starts with the first word first, and finds nothing for nothing", async () => {
  const h = harness();
  const a = await handlers["settings.search"](asMaya(h), { q: "working hours" });
  assert.ok(a.rows.length >= 2 && a.rows[0]!.title.toLowerCase().startsWith("working hours"));
  const b = await handlers["settings.search"](asMaya(h), { q: "hours working" });
  assert.deepEqual(b.rows.map((r) => r.key).sort(), a.rows.map((r) => r.key).sort());
  assert.deepEqual((await handlers["settings.search"](asMaya(h), { q: "   " })).rows, []);
  assert.deepEqual((await handlers["settings.search"](asMaya(h), { q: "zzzzzz" })).rows, []);
  assert.ok(search("appearance").some((r) => r.key === "appearance.skin"), "the page name is searched too");
});

test("a setting nobody changed reads as its shipped default", async () => {
  const h = harness();
  const r = (await handlers["settings.get"](asMaya(h), { key: "memory.weekly_nudge" })).row;
  assert.equal(r.value, true);
  assert.equal(r.default, true);
  assert.equal(r.source, "default");
  assert.equal(r.page, "privacy");
  assert.equal(r.scope, "person");
  assert.equal(r.floorable, false);
  await assert.rejects(handlers["settings.get"](asMaya(h), { key: "no.such" }), (e) => codeOf(e) === "validation.not_found");
});

test("a change saves as it is made, says what it was, and Undo is one more call", async () => {
  const h = harness();
  const out = await handlers["settings.set"](asMaya(h), { key: "profile.timezone", value: "Asia/Karachi" });
  assert.equal(out.row.value, "Asia/Karachi");
  assert.equal(out.row.source, "person");
  assert.equal(out.previous, "UTC");
  assert.deepEqual(names(h), ["settings.changed"]);
  assert.deepEqual(h.events[0]!.payload, { key: "profile.timezone", scope: "person", person: MAYA, before: "UTC", after: "Asia/Karachi", by: MAYA });
  const undo = await handlers["settings.set"](asMaya(h), { key: "profile.timezone", value: out.previous });
  assert.equal(undo.row.value, "UTC");
  assert.equal(undo.previous, "Asia/Karachi");
});

test("each person's value is their own: Omar's change does not move Maya's", async () => {
  const h = harness();
  await handlers["settings.set"](asMaya(h), { key: "chat.agent_tabs", value: false });
  const omar = (await handlers["settings.get"](h.as(OMAR), { key: "chat.agent_tabs" })).row;
  assert.equal(omar.value, true);
  assert.equal((await handlers["settings.get"](asMaya(h), { key: "chat.agent_tabs" })).row.value, false);
  const lists = (await handlers["settings.list"](asMaya(h), { page: "keyboard" })).rows;
  assert.deepEqual(lists.map((r) => r.key).sort(), ["chat.agent_tabs", "keyboard.overrides"]);
});

test("a value the schema refuses is refused with a sentence and nothing is written", async () => {
  const h = harness();
  const bad = async (key: string, value: unknown, code: string): Promise<void> => {
    h.events.length = 0;
    await assert.rejects(handlers["settings.set"](asMaya(h), { key, value }), (e) => codeOf(e) === code, `${key}`);
    assert.deepEqual(h.events, []);
  };
  await bad("profile.handle", "A B", "validation.bad_input");
  await bad("sync.blob_cache_mb", 5, "validation.bad_input");
  await bad("appearance.mode", "sepia", "validation.bad_input");
  await bad("memory.weekly_nudge", "yes", "validation.bad_input");
  await bad("notifications.push_idle_minutes", 5, "validation.bad_input");
  assert.equal(h.raw.rows("settings_value").length, 0);
  try { await handlers["settings.set"](asMaya(h), { key: "profile.handle", value: "A B" }); } catch (e) { assert.match(JSON.stringify(e), /Handle/); }
});

test("a call that is not a person is refused", async () => {
  const h = harness();
  await assert.rejects(handlers["settings.set"](h.system(), { key: "profile.title", value: "x" }), (e) => codeOf(e) === "auth.unauthenticated");
  await assert.rejects(handlers["settings.list"](h.system(), {}), (e) => codeOf(e) === "auth.unauthenticated");
});

test("reset puts the Space default back, says so, and says nothing when nothing changed", async () => {
  const h = harness();
  await handlers["settings.set"](asMaya(h), { key: "memory.weekly_nudge", value: false });
  h.events.length = 0;
  const out = await handlers["settings.reset"](asMaya(h), { key: "memory.weekly_nudge" });
  assert.equal(out.row.value, true);
  assert.equal(out.row.source, "default");
  assert.deepEqual(h.events.map((e) => (e.payload as { after: unknown }).after), [true]);
  h.events.length = 0;
  await handlers["settings.reset"](asMaya(h), { key: "memory.weekly_nudge" });
  assert.deepEqual(h.events, [], "already at the default");
});

test("a Space value is the default everyone gets until they choose their own, and reset goes back to it", async () => {
  const h = harness();
  const sp = await handlers["settings.set_space"](adminOmar(h), { key: "memory.weekly_nudge", value: false });
  assert.equal(sp.previous, true);
  assert.equal(sp.row.source, "space");
  const maya = (await handlers["settings.get"](asMaya(h), { key: "memory.weekly_nudge" })).row;
  assert.deepEqual([maya.value, maya.source], [false, "space"]);
  await handlers["settings.set"](asMaya(h), { key: "memory.weekly_nudge", value: true });
  assert.equal((await handlers["settings.get"](asMaya(h), { key: "memory.weekly_nudge" })).row.source, "person");
  await handlers["settings.reset"](asMaya(h), { key: "memory.weekly_nudge" });
  const back = (await handlers["settings.get"](asMaya(h), { key: "memory.weekly_nudge" })).row;
  assert.deepEqual([back.value, back.source], [false, "space"], "reset goes to the Space's value, not the shipped one");
  const gone = await handlers["settings.reset_space"](adminOmar(h), { key: "memory.weekly_nudge" });
  assert.deepEqual([gone.row.value, gone.row.source], [true, "default"]);
  const event = h.events.filter((e) => e.name === "settings.changed")[0]!.payload as { scope: string; person?: string };
  assert.equal(event.scope, "space");
  assert.equal(event.person, undefined);
});

test("a person cannot change a Space-wide row through set, and the Space row is refused for a wrong value", async () => {
  const h = harness();
  await assert.rejects(handlers["settings.set"](asMaya(h), { key: "notifications.push_idle_minutes", value: 10 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["settings.reset"](asMaya(h), { key: "notifications.push_idle_minutes" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["settings.set_space"](adminOmar(h), { key: "notifications.push_idle_minutes", value: 900 }), (e) => codeOf(e) === "validation.bad_input");
  const ok = await handlers["settings.set_space"](adminOmar(h), { key: "notifications.push_idle_minutes", value: 10 });
  assert.equal(ok.row.value, 10);
});

test("the owner floor: nobody may choose a value less strict than it, and the row says what the floor is", async () => {
  const h = harness();
  await assert.rejects(handlers["settings.floor_set"](adminOmar(h), { key: "profile.title", floor: "x" }), (e) => codeOf(e) === "validation.bad_input", "a setting that is not floorable");
  await assert.rejects(handlers["settings.floor_set"](adminOmar(h), { key: "security.level", floor: "paranoid" }), (e) => codeOf(e) === "validation.bad_input");
  const set = await handlers["settings.floor_set"](adminOmar(h), { key: "security.level", floor: "standard" });
  assert.equal(set.row.floorable, true);
  assert.equal(set.row.floor, "standard");
  assert.deepEqual(names(h), ["settings.floor_changed"]);
  await assert.rejects(handlers["settings.set"](asMaya(h), { key: "security.level", value: "relaxed" }), (e) => codeOf(e) === "validation.field_locked");
  assert.equal((await handlers["settings.set"](asMaya(h), { key: "security.level", value: "strict" })).row.value, "strict");
  assert.equal((await handlers["settings.set"](asMaya(h), { key: "security.level", value: "standard" })).row.value, "standard");
  const row = (await handlers["settings.get"](asMaya(h), { key: "security.level" })).row;
  assert.equal(row.floor, "standard");
});

test("a floor holds for a mode's per-Space values too, and a number floor counts a smaller value as stricter", async () => {
  const h = harness();
  await handlers["settings.floor_set"](adminOmar(h), { key: "security.terminal_mode", floor: { base: "allow", spaces: {} } });
  await assert.rejects(handlers["settings.set"](asMaya(h), { key: "security.terminal_mode", value: { base: "auto", spaces: {} } }), (e) => codeOf(e) === "validation.field_locked");
  await assert.rejects(handlers["settings.set"](asMaya(h), { key: "security.terminal_mode", value: { base: "ask", spaces: { spc_x: "auto" } } }), (e) => codeOf(e) === "validation.field_locked");
  assert.ok((await handlers["settings.set"](asMaya(h), { key: "security.terminal_mode", value: { base: "ask", spaces: { spc_x: "allow" } } })).row);
  await handlers["settings.floor_set"](adminOmar(h), { key: "engine.agent_hops", floor: 6 });
  await assert.rejects(handlers["settings.set_space"](adminOmar(h), { key: "engine.agent_hops", value: 8 }), (e) => codeOf(e) === "validation.field_locked");
  assert.equal((await handlers["settings.set_space"](adminOmar(h), { key: "engine.agent_hops", value: 3 })).row.value, 3);
});

test("Copy from another Space: the source offers my profile without a title and without empty values", async () => {
  const h = harness();
  assert.deepEqual(await handlers["settings.copy_source"](asMaya(h), {}), { timezone: "UTC", hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" } });
  await handlers["settings.set"](asMaya(h), { key: "profile.display_name", value: "Maya Chen" });
  await handlers["settings.set"](asMaya(h), { key: "profile.handle", value: "maya" });
  await handlers["settings.set"](asMaya(h), { key: "profile.title", value: "Partner" });
  await handlers["settings.set"](asMaya(h), { key: "profile.contact", value: { email: "maya@northwind.example" } });
  await handlers["settings.set"](asMaya(h), { key: "profile.photo", value: "fil_maya1" });
  const src = await handlers["settings.copy_source"](asMaya(h), {});
  assert.deepEqual(src, { photoFileId: "fil_maya1", name: "Maya Chen", handle: "maya", timezone: "UTC", hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }, contact: { email: "maya@northwind.example" } });
  assert.ok(!("title" in src));
});

test("Copy from another Space applies only the ticked fields, never the title, and each one is a change you can see", async () => {
  const h = harness();
  const out = await handlers["settings.copy_profile"](asMaya(h), {
    fields: ["name", "handle", "contact", "photo"],
    values: { name: "Maya Chen", handle: "maya", contact: { phone: "+1 415 555 0100" }, photo: "fil_maya1", title: "Partner", timezone: "Asia/Karachi" },
  });
  assert.deepEqual(out.applied, ["name", "handle", "contact", "photo"]);
  const get = async (k: string) => (await handlers["settings.get"](asMaya(h), { key: k })).row.value;
  assert.equal(await get("profile.display_name"), "Maya Chen");
  assert.equal(await get("profile.handle"), "maya");
  assert.deepEqual(await get("profile.contact"), { phone: "+1 415 555 0100" });
  assert.equal(await get("profile.photo"), "fil_maya1");
  assert.equal(await get("profile.title"), "", "the title is never copied");
  assert.equal(await get("profile.timezone"), "UTC", "a field that was not ticked is left alone");
  assert.equal(names(h).filter((n) => n === "settings.changed").length, 4);
});

test("Copy from another Space refuses a bad value or a missing one before it writes anything", async () => {
  const h = harness();
  await assert.rejects(handlers["settings.copy_profile"](asMaya(h), { fields: ["name", "handle"], values: { name: "Maya", handle: "A B" } }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["settings.copy_profile"](asMaya(h), { fields: ["timezone"], values: {} }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(handlers["settings.copy_profile"](asMaya(h), { fields: ["title" as never], values: { title: "x" } }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.raw.rows("settings_value").length, 0);
  assert.deepEqual(h.events, []);
});

test("the Kit: the Space's choice, mine, and the one in effect, with null following the Space", async () => {
  const h = harness();
  assert.deepEqual((await handlers["settings.kit.get"](asMaya(h), {})).kit, { space: null, person: null, effective: "kit_default" });
  const sp = await handlers["settings.kit.set_space"](adminOmar(h), { kitId: "kit_law" });
  assert.deepEqual(sp.kit, { space: "kit_law", person: null, effective: "kit_law" });
  const mine = await handlers["settings.kit.set_mine"](asMaya(h), { kitId: "kit_studio" });
  assert.deepEqual(mine.kit, { space: "kit_law", person: "kit_studio", effective: "kit_studio" });
  assert.deepEqual((await handlers["settings.kit.get"](h.as(OMAR), {})).kit, { space: "kit_law", person: null, effective: "kit_law" }, "Omar still follows the Space");
  const follow = await handlers["settings.kit.set_mine"](asMaya(h), { kitId: null });
  assert.deepEqual(follow.kit, { space: "kit_law", person: null, effective: "kit_law" });
  await assert.rejects(handlers["settings.kit.set_mine"](asMaya(h), { kitId: "studio" }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(names(h).filter((n) => n === "settings.changed").length, 3, "a repeat that changes nothing says nothing");
  h.events.length = 0;
  await handlers["settings.kit.set_mine"](asMaya(h), { kitId: null });
  assert.deepEqual(h.events, []);
});

test("every statement the module sends is one the host's table guard allows", async () => {
  const h = harness();
  await handlers["settings.set"](asMaya(h), { key: "profile.title", value: "Partner" });
  await handlers["settings.set_space"](adminOmar(h), { key: "memory.weekly_nudge", value: false });
  await handlers["settings.floor_set"](adminOmar(h), { key: "security.level", floor: "standard" });
  for (const sql of h.raw.log) assert.match(sql, /settings_(value|floor)/);
  assert.ok(PAGES.length === 10);
});
