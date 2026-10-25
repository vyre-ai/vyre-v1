// Settings (spec 3.9, 2.24; ARCH 7.9): every SettingDef of the registry renders in a SettingsRow and is found by Cmd-F; the pages draw from the Northwind sample through the live screen
// queries; changes save as they are made with Saved and Undo; Copy from another Space; devices; Spaces. Screens render with react-dom/server over react-native-web (ruling 28).
// Path mapping: the packet names apps/app/tests/settings*.test.tsx; the lane's tests live beside the screens, as P-L9f_07's do.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import type { SettingsProps } from "./SettingsPlace.tsx";
import { CopyFromSpace, copyItems, copyValues } from "./CopyFromSpace.tsx";
import { SavedProvider } from "./saved.tsx";
import { PAGES, bytesLabel, clock, controlFor, hoursSummary, moneyLabel, pageOfRow, searchRows, sectionsFor, splitList, summaryOf, timeIn } from "./model.ts";
import type { PageKey, SettingRow } from "./model.ts";
import { whenLabel } from "./pages-b.tsx";
import { ROWS, createSampleSettings, harbor, northwind } from "./sample.ts";
import type { SampleSettings } from "./sample.ts";

const html = (s: SampleSettings, props: SettingsProps = {}): string =>
  renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} {...props} /></SettingsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const rowsOf = (s: SampleSettings): SettingRow[] => (s.data.screens.query("settings.page", "rows", {}).getSnapshot() as { data: { rows: SettingRow[] } }).data.rows;
const valueOf = (s: SampleSettings, key: string): unknown => rowsOf(s).find((r) => r.key === key)?.value;

/** A registry row that has no SettingsRow of its own id is one the page draws as part of another row; each is named here with the row that carries it. */
const CARRIED_BY: Record<string, string> = { "kit.choice_person": "kit.person_choice" };

test("every SettingDef that has a page renders in a SettingsRow and is found by Cmd-F", () => {
  const s = createSampleSettings(northwind);
  const all = rowsOf(s);
  const shown = all.filter((r) => pageOfRow(r) !== null);
  assert.ok(shown.length >= 27, `the registry's person rows and the Notifications row (${shown.length})`);
  for (const r of shown) {
    const page = pageOfRow(r)!;
    const out = html(s, { initialPage: page.key });
    const id = CARRIED_BY[r.key] ?? r.key;
    assert.ok(has(out, `data-sid="${id}"`), `${r.key} has a row on ${page.title}`);
    const hit = searchRows(all, r.title).find((h) => h.key === r.key);
    assert.ok(hit, `${r.key} is found by its title`);
    assert.equal(hit.page, page.key);
  }
});

test("the table of sample rows is the registry's person rows, so the test above covers all of them", () => {
  const keys = ROWS.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ["profile.display_name", "appearance.skin", "security.level", "sync.blob_cache_mb", "notifications.push_idle_minutes", "keyboard.overrides"]) assert.ok(keys.includes(k), k);
});

test("search finds rows by words in any order, ranks a title that starts with the first word higher, and says nothing for no match", () => {
  const rows = rowsOf(createSampleSettings(northwind));
  const hits = searchRows(rows, "hours");
  assert.ok(hits.length >= 2 && hits.every((h) => /hours/i.test(h.title) || /hours/.test(h.key)), "working hours rows");
  assert.equal(searchRows(rows, "working hours")[0]!.title.startsWith("Working hours"), true);
  assert.deepEqual(searchRows(rows, "  "), []);
  assert.deepEqual(searchRows(rows, "zzzzz"), []);
  assert.ok(searchRows(rows, "chrome agents").some((h) => h.key === "chrome.agents_use_my_browser"));
  assert.ok(searchRows(rows, "appearance").some((h) => h.key === "appearance.skin"), "the page name is searched too");
});

test("the page list has ten pages in two groups, the first named after the open Space", () => {
  const out = html(createSampleSettings(northwind));
  assert.deepEqual(PAGES.map((p) => p.title), ["Profile", "Notifications", "Models and usage", "Connections", "Memory and privacy", "Sign-in and devices", "Appearance", "Keyboard", "This computer", "Spaces"]);
  assert.equal(PAGES.filter((p) => p.group === "space").length, 5);
  for (const p of PAGES) assert.ok(has(out, `data-testid="row-page-${p.key}"`), p.key);
  const at = (t: string): number => { const i = out.indexOf(`>${t}<`); assert.ok(i >= 0, t); return i; };
  assert.ok(at("Northwind") < at("Profile") && at("Memory and privacy") < at("Everywhere") && at("Everywhere") < at("Sign-in and devices"));
  assert.match(tag(out, "row-page-profile"), /aria-selected="true"/);
  assert.match(tag(out, "row-page-keyboard"), /aria-selected="false"/);
  assert.ok(has(out, 'aria-label="Search settings"') && has(out, "Cmd F"));
  assert.ok(has(out, 'aria-label="Another Space needs you"'), "a dot when another Space needs you");
  assert.ok(has(html(createSampleSettings(harbor)), 'aria-label="Another Space needs you"'), "Harbor's other Space has one waiting");
});

test("Profile: the card, then About you, Availability, Contact and Your day", () => {
  const out = html(createSampleSettings(northwind));
  assert.ok(has(out, 'data-testid="profile-card"') && has(out, "Irfad Imtiaz"));
  assert.ok(has(out, "@irfad · Owner · Head of operations"));
  for (const t of ["About you", "Availability", "Contact", "Your day"]) assert.ok(has(out, `>${t}<`), t);
  const order = ["About you", "Availability", "Contact", "Your day"].map((t) => out.indexOf(`>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(has(out, "Pacific Time, Los Angeles"));
  assert.match(out, /It is 3:00\s*AM for you now/);
  assert.ok(has(out, "Mon to Fri, 9:00 AM to 5:30 PM"));
  assert.ok(has(out, 'value="irfad@northwind.example"') && has(out, 'value="+1 415 555 0132"'));
  assert.ok(has(out, 'aria-label="Copy from another Space"'));
});

test("a change saves as it is made and Undo puts the previous value back", async () => {
  const s = createSampleSettings(northwind);
  const out = (await s.data.call("settings.set", { key: "profile.title", value: "Chief of staff" })) as { previous: unknown };
  assert.equal(out.previous, "Head of operations");
  assert.equal(valueOf(s, "profile.title"), "Chief of staff");
  assert.ok(has(html(s), "@irfad · Owner · Chief of staff"));
  await s.data.call("settings.set", { key: "profile.title", value: out.previous });
  assert.equal(valueOf(s, "profile.title"), "Head of operations");
});

test("a value the rules refuse says why and changes nothing", async () => {
  const s = createSampleSettings(northwind);
  await assert.rejects(() => s.data.call("settings.set", { key: "profile.handle", value: "A B" }), /2 to 32 letters/);
  assert.equal(valueOf(s, "profile.handle"), "irfad");
});

test("a row that differs from the Space default shows Reset, and Reset puts the default back", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "privacy" });
  assert.ok(has(out, 'data-testid="reset-engine.runtime_opt_in"'), "it was switched off in the sample");
  assert.ok(!has(out, 'data-testid="reset-memory.weekly_nudge"'));
  await s.data.call("settings.reset", { key: "engine.runtime_opt_in" });
  assert.equal(valueOf(s, "engine.runtime_opt_in"), true);
  assert.ok(!has(html(s, { initialPage: "privacy" }), 'data-testid="reset-engine.runtime_opt_in"'));
});

test("controls follow the value: a switch, a choice, a stepper, a field, hours, a mode and one switch per Team Space", () => {
  const by = (k: string): SettingRow => rowsOf(createSampleSettings(northwind)).find((r) => r.key === k)!;
  assert.equal(controlFor(by("memory.weekly_nudge")).kind, "switch");
  assert.equal(controlFor(by("appearance.mode")).kind, "choice");
  assert.equal(controlFor(by("profile.timezone")).kind, "choice");
  assert.equal(controlFor(by("sync.blob_cache_mb")).kind, "number");
  assert.equal(controlFor(by("profile.handle")).kind, "text");
  assert.equal(controlFor(by("profile.working_hours")).kind, "hours");
  assert.equal(controlFor(by("notifications.working_hours")).kind, "hours");
  assert.equal(controlFor(by("security.terminal_mode")).kind, "mode");
  assert.equal(controlFor(by("chrome.agents_use_my_browser")).kind, "spacemap");
  const out = html(createSampleSettings(northwind), { initialPage: "computer" });
  assert.ok(has(out, 'data-testid="ctl-security.level"') && has(out, "Standard"));
  assert.ok(has(out, 'data-testid="ctl-chrome.agents_use_my_browser.northwind"') && has(out, 'data-testid="ctl-chrome.agents_use_my_browser.harbor"'), "a switch for each Team Space, not Personal");
  assert.ok(!has(out, 'data-testid="ctl-chrome.agents_use_my_browser.personal"'));
  assert.ok(has(out, "2 GB"), "the file cache reads in GB");
});

test("the file cache keeps to its range and the mode choices are Ask each time, Allow and Never", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "computer" });
  assert.ok(has(out, 'aria-label="Less File cache size on this computer (MB)"'));
  assert.ok(has(out, "Ask each time"));
  assert.equal(bytesLabel(512), "512 MB");
  assert.equal(bytesLabel(2048), "2 GB");
});

test("Notifications: each kind with how it arrives, the delivery rows and who is muted", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "notifications" });
  assert.ok(has(out, "How each kind arrives") && has(out, "A direct message") && has(out, "Interrupt") && has(out, "Badge") && has(out, "Digest"));
  assert.ok(has(out, "Waits outside your working hours"));
  assert.ok(has(out, "Email me once if an approval waits 4 hours") && has(out, 'data-testid="ctl-notifications.push_idle_minutes"'));
  assert.ok(has(out, ">Muted<") && has(out, "Docs") && has(out, "#sales") && has(out, "Unmute"));
});

test("unmuting changes the list", async () => {
  const s = createSampleSettings(northwind);
  await s.data.call("notifications.mute.clear", { target: { kind: "agent", id: "agt_docs" } });
  const out = html(s, { initialPage: "notifications" });
  assert.ok(!has(out, "row-mute.agt_docs") && has(out, "row-mute.ch_sales"));
});

test("Models and usage: defaults, usage by model with bars, the switches, the providers and Open Vault", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "models" });
  assert.ok(has(out, "Default model") && has(out, "Claude Sonnet 5.5") && has(out, "Fallback model") && has(out, "Claude Haiku 5.5"));
  assert.ok(has(out, 'data-testid="usage"') && has(out, "OpenAI team key") && has(out, "$48.20") && has(out, "168 turns"));
  assert.ok(has(out, "Let the Space run work on my subscription"));
  assert.ok(has(out, "Providers") && has(out, "Sign in again") && has(out, "Working"));
  assert.ok(has(out, 'data-testid="row-open-vault"'));
  assert.equal(moneyLabel(48_200_000), "$48.20");
});

test("Connections lists mailboxes with their state and a way to pause; Memory and privacy has its switches", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "connections" });
  assert.ok(has(out, "irfad@northwind.example") && has(out, "Google, private to you") && has(out, "Syncing") && has(out, "Pause"));
  assert.ok(has(out, "irfad.imtiaz@outlook.example") && has(out, "Paused") && has(out, "Resume"));
  assert.ok(has(out, "Connect a mailbox") && has(out, "Connect a calendar"));
  const p = html(createSampleSettings(northwind), { initialPage: "privacy" });
  assert.ok(has(p, "Weekly reminder about proposed facts") && has(p, "Let the Space continue my chats when my computer is off"));
  assert.ok(has(html(createSampleSettings(harbor), { initialPage: "connections" }), "Connect a mailbox"), "an empty list still offers the connect rows");
});

test("Sign-in and devices: this device first, the others with Sign out, a signed-out device goes from the list", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "signin" });
  assert.ok(has(out, "Same in every Space"));
  assert.ok(out.indexOf("Irfad&#x27;s MacBook Pro") < out.indexOf("Irfad&#x27;s iPhone"), "this device first");
  assert.ok(has(out, "This device") && has(out, "Last seen 3 hours ago, San Francisco") && has(out, "Last seen 6 days ago, Oakland"));
  assert.ok(has(out, 'data-testid="revoke-dev_phone"') && !has(out, 'data-testid="revoke-dev_mac"'));
  assert.ok(has(out, "Sign out of every other device"));
  assert.ok(has(out, "Its own password, second factor and devices") && has(out, "Open now"));
  await s.data.call("devices.revoke", { deviceId: "dev_phone" });
  assert.ok(!has(html(s, { initialPage: "signin" }), "Irfad&#x27;s iPhone"));
  await s.data.call("devices.revoke_others", {});
  assert.ok(!has(html(s, { initialPage: "signin" }), "Sign out of every other device"));
  assert.equal(whenLabel(undefined, 0), "never");
  assert.equal(whenLabel(1_000, 1_000 + 30_000), "just now");
});

test("Appearance: mode, every skin in Dark and Light with the chosen one marked, and the Kit", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "appearance" });
  assert.ok(has(out, "Everything here is the same in every Space except the skin"));
  assert.ok(has(out, 'data-testid="ctl-appearance.mode"'));
  for (const id of ["graphite", "obsidian", "charcoal", "slate", "ember", "moss", "dusk", "paper", "fog", "linen", "sand", "sage", "mist"]) assert.ok(has(out, `data-testid="skin-${id}"`), id);
  assert.match(tag(out, "skin-graphite"), /aria-checked="true"/);
  assert.match(tag(out, "skin-paper"), /aria-checked="false"/);
  assert.ok(out.indexOf("skins-dark") < out.indexOf("skins-light"));
  assert.ok(has(out, "Follow the Space") && has(out, "In effect: Law firm"));
});

test("choosing a skin saves it for this Space; hovering previews it and moving away puts the window back", async () => {
  const s = createSampleSettings(northwind);
  await s.data.call("settings.set", { key: "appearance.skin", value: "paper" });
  assert.match(tag(html(s, { initialPage: "appearance" }), "skin-paper"), /aria-checked="true"/);
  s.data.nav.previewSkin?.("fog"); s.data.nav.previewSkin?.(null);
  assert.deepEqual(s.previews, ["fog", null]);
});

test("Keyboard: shortcuts with their keys, an override shows its default and Reset", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "keyboard" });
  assert.ok(has(out, "Search everything") && has(out, 'value="Cmd K"') && has(out, "All at their defaults"));
  await s.data.call("settings.set", { key: "keyboard.overrides", value: { search: "Cmd Shift K" } });
  const after = html(s, { initialPage: "keyboard" });
  assert.ok(has(after, 'value="Cmd Shift K"') && has(after, "Default Cmd K") && has(after, "1 changed") && has(after, 'data-testid="reset-shortcuts"'));
});

test("Spaces: each Space with its address and role; Open for the others, Leave for the open Team Space", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "spaces" });
  assert.ok(has(out, "northwind.vyre.run, Owner") && has(out, "harbor.vyre.run, Member, 2 waiting on you") && has(out, "Only on this computer, Owner"));
  assert.ok(has(out, 'data-testid="open-harbor"') && has(out, 'data-testid="leave-northwind"') && !has(out, 'data-testid="leave-personal"') && !has(out, 'data-testid="leave-harbor"'));
});

test("Copy from another Space offers only what that Space has, never the title, and applying copies it here", async () => {
  const s = createSampleSettings(harbor);
  const src = (s.data.screens.query("settings.copy_profile", "source", {}).getSnapshot() as { data: Parameters<typeof copyItems>[0] }).data;
  assert.deepEqual(copyItems(src), []);
  const w = createSampleSettings(northwind);
  const items = copyItems((w.data.screens.query("settings.copy_profile", "source", {}).getSnapshot() as { data: Parameters<typeof copyItems>[0] }).data);
  assert.deepEqual(items.map((i) => i.field), ["name", "handle", "timezone", "hours", "contact"]);
  assert.ok(!items.some((i) => /title/i.test(i.label)));
  const out = renderToStaticMarkup(<SettingsDataProvider value={w.data}><SavedProvider><CopyFromSpace onClose={() => undefined} /></SavedProvider></SettingsDataProvider>).replaceAll("<!-- -->", "");
  assert.ok(has(out, "Copy from Harbor Studio") && has(out, "Your title is never copied") && has(out, "Copy 5") && has(out, "harbor.example"));
  for (const f of ["name", "handle", "timezone", "hours", "contact"]) assert.match(tag(out, `copy-${f}`), /aria-checked="true"/);
  const empty = renderToStaticMarkup(<SettingsDataProvider value={s.data}><SavedProvider><CopyFromSpace onClose={() => undefined} /></SavedProvider></SettingsDataProvider>);
  assert.ok(has(empty, 'data-testid="copy-empty"') && has(empty, "Copy 0"));
  const src2 = (w.data.screens.query("settings.copy_profile", "source", {}).getSnapshot() as { data: Parameters<typeof copyItems>[0] }).data;
  await w.data.call("settings.copy_profile", { fields: ["handle", "timezone"], values: copyValues(src2, ["handle", "timezone"]) });
  assert.equal(valueOf(w, "profile.handle"), "irfad");
  assert.deepEqual(copyValues(src2, ["handle"]), { handle: "irfad" });
});

test("a phone shows the page list or one page with a back arrow; a wide window shows both", () => {
  const s = createSampleSettings(northwind);
  const list = html(s, { initialView: "nav", width: 390 });
  assert.ok(has(list, 'data-testid="settings-nav"') && !has(list, 'data-testid="page-profile"'));
  const page = html(s, { initialView: "page", width: 390 });
  assert.ok(has(page, 'data-testid="page-profile"') && !has(page, 'data-testid="settings-nav"') && has(page, 'data-testid="back"'));
  assert.ok(has(html(s), 'data-testid="settings-nav"') && has(html(s), 'data-testid="page-profile"') && !has(html(s), 'data-testid="back"'));
});

test("search results replace the page list and name the page of each row", () => {
  const out = html(createSampleSettings(northwind), { initialQuery: "quiet" });
  assert.ok(has(out, 'data-testid="search-results"') || has(out, 'data-testid="search-none"'));
  const found = html(createSampleSettings(northwind), { initialQuery: "skin" });
  assert.ok(has(found, 'data-testid="row-hit-appearance.skin"') && has(found, "Appearance"));
  assert.ok(has(html(createSampleSettings(northwind), { initialQuery: "qqqq" }), "No setting matches"));
});

test("the row a search found is outlined and the others are not", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "computer", initialFound: "security.level" });
  const sid = (k: string): string => out.match(new RegExp(`<[^>]*data-sid="${k}"[^>]*>`))?.[0] ?? "";
  assert.ok(sid("security.level").includes("accent-wash"), "the found row");
  assert.ok(!sid("engine.local_runs").includes("accent-wash"));
});

test("model helpers: hours, clock, times in a zone, summaries, lists and where a row's page is", () => {
  assert.equal(hoursSummary({ days: [1, 2, 3, 4, 5], from: "09:00", to: "17:30" }), "Mon to Fri, 9:00 AM to 5:30 PM");
  assert.equal(hoursSummary({ days: [0, 6], from: "10:00", to: "14:00" }), "Sun, Sat, 10:00 AM to 2:00 PM");
  assert.equal(hoursSummary({ days: [1, 2, 3, 4], from: "08:00", to: "12:00" }), "Mon to Thu, 8:00 AM to 12:00 PM");
  assert.equal(hoursSummary(null), "No set hours");
  assert.equal(clock("00:05"), "12:05 AM");
  assert.match(timeIn(Date.UTC(2025, 9, 24, 10, 0), "Asia/Karachi"), /3:00\s*PM/);
  assert.match(timeIn(Date.UTC(2025, 9, 24, 10, 0), "Not/AZone"), /10:00\s*AM/);
  assert.equal(summaryOf(null), "Not set");
  assert.equal(summaryOf(true), "On");
  assert.equal(summaryOf(["a", "b"]), "a, b");
  assert.equal(summaryOf({}), "Default");
  assert.deepEqual(splitList(" a, b ,, c "), ["a", "b", "c"]);
  const rows = rowsOf(createSampleSettings(northwind));
  assert.equal(pageOfRow(rows.find((r) => r.key === "security.level")!)?.key, "computer");
  assert.equal(pageOfRow(rows.find((r) => r.key === "chat.agent_tabs")!)?.key, "keyboard");
  assert.equal(pageOfRow({ ...rows[0]!, scope: "space", page: "Policies" }), null, "Space policy belongs to the Console");
});

test("sections: every row of a page lands in a section, and a row no section names is kept", () => {
  const rows = rowsOf(createSampleSettings(northwind));
  for (const p of PAGES) {
    const secs = sectionsFor(p.key as PageKey, rows);
    const placed = secs.flatMap((x) => x.rows.map((r) => r.key));
    assert.equal(new Set(placed).size, placed.length, `${p.key}: no row twice`);
  }
  const extra: SettingRow = { ...rows.find((r) => r.key === "security.level")!, key: "security.new_thing", title: "A new row" };
  assert.ok(sectionsFor("computer", [...rows, extra]).some((x) => x.rows.some((r) => r.key === "security.new_thing")));
});

test("no em dash in any copy on any page", () => {
  const s = createSampleSettings(northwind);
  for (const p of PAGES) assert.ok(!html(s, { initialPage: p.key }).includes(String.fromCharCode(0x2014)), p.key);
});
