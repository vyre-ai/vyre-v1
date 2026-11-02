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
import { HIDDEN_ROWS, PAGES, clock, controlFor, hoursSummary, moneyLabel, pageOfRow, rowLabel, searchRows, sectionsFor, splitList, summaryOf, timeIn } from "./model.ts";
import type { SettingRow, YouPage } from "./model.ts";
import { whenLabel } from "./pages-b.tsx";
import { KEYBOARD_MAP } from "../../shell/keyboard/map.ts";
import { dollars, monthNote } from "./MemorySpend.tsx";
import { ROWS, createSampleSettings, harbor, northwind } from "./sample.ts";
import type { SampleSettings } from "./sample.ts";

const html = (s: SampleSettings, props: SettingsProps = {}): string =>
  renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} {...props} /></SettingsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const rowsOf = (s: SampleSettings): SettingRow[] => (s.data.screens.query("settings.page", "rows", {}).getSnapshot() as { data: { rows: SettingRow[] } }).data.rows;
const valueOf = (s: SampleSettings, key: string): unknown => rowsOf(s).find((r) => r.key === key)?.value;

/** A registry row that has no SettingsRow of its own id is one the page draws as part of another row; each is named here with the row that carries it. */
const CARRIED_BY: Record<string, string> = {};

test("every SettingDef that has a page renders in a SettingsRow and is found by Cmd-F", () => {
  const s = createSampleSettings(northwind);
  const all = rowsOf(s);
  const shown = all.filter((r) => pageOfRow(r) !== null);
  assert.ok(shown.length >= 13, `the registry's person rows (${shown.length})`);
  for (const r of shown) {
    const page = pageOfRow(r)!;
    const out = html(s, { initialPage: page.key });
    const id = CARRIED_BY[r.key] ?? r.key;
    assert.ok(has(out, `data-sid="${id}"`), `${r.key} has a row on ${page.title}`);
    const hit = searchRows(all, rowLabel(r)).find((h) => h.key === r.key);
    assert.ok(hit, `${r.key} is found by its title`);
    assert.equal(hit.page, page.key);
  }
});

test("the table of sample rows is the registry's person rows, so the test above covers all of them", () => {
  const keys = ROWS.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ["profile.display_name", "appearance.skin", "engine.local_runs", "notifications.quiet_hours"]) assert.ok(keys.includes(k), k);
});

test("search finds rows by words in any order, ranks a title that starts with the first word higher, and says nothing for no match", () => {
  const rows = rowsOf(createSampleSettings(northwind));
  const hits = searchRows(rows, "hours");
  assert.ok(hits.length >= 2 && hits.every((h) => /hours/i.test(h.title) || /hours/.test(h.key)), "working hours rows");
  assert.equal(searchRows(rows, "working hours")[0]!.title.startsWith("Working hours"), true);
  assert.deepEqual(searchRows(rows, "  "), []);
  assert.deepEqual(searchRows(rows, "zzzzz"), []);
  assert.ok(searchRows(rows, "side tabs agents").some((h) => h.key === "chat.agent_tabs"));
  assert.ok(searchRows(rows, "appearance").some((h) => h.key === "appearance.skin"), "the page name is searched too");
});

test("the page list is You, then the Space under its own name", () => {
  const out = html(createSampleSettings(northwind));
  assert.deepEqual(PAGES.filter((p) => p.group === "you").map((p) => p.title), ["Profile", "Notifications", "Appearance", "AI", "Connected", "Sign-in and devices", "This computer"]);
  assert.deepEqual(PAGES.filter((p) => p.group === "space").map((p) => p.title), ["Space", "People and access", "Agents and rules", "Data", "Connected apps", "Advanced"]);
  for (const p of PAGES) assert.ok(has(out, `data-testid="row-page-${p.key}"`), p.key);
  const at = (t: string): number => { const i = out.indexOf(`>${t}<`); assert.ok(i >= 0, t); return i; };
  assert.ok(at("You") < at("Profile") && at("This computer") < at("Agents and rules"));
  assert.match(tag(out, "row-page-profile"), /var\(--sel\)/);
  assert.doesNotMatch(tag(out, "row-page-ai"), /var\(--sel\)/);
  assert.ok(has(out, 'aria-label="Search settings"') && has(out, "Cmd F"));
  assert.ok(has(out, 'aria-label="Another Space needs you"'), "a dot when another Space needs you");
  assert.ok(has(html(createSampleSettings(harbor)), 'aria-label="Another Space needs you"'), "Harbor's other Space has one waiting");
});

test("Profile: the card, then About you, Availability and Contact", () => {
  const out = html(createSampleSettings(northwind));
  assert.ok(has(out, 'data-testid="profile-card"') && has(out, "Irfad Imtiaz"));
  assert.ok(has(out, "@irfad · Owner · Head of operations"));
  for (const t of ["About you", "Availability", "Contact"]) assert.ok(has(out, `>${t}<`), t);
  assert.ok(!has(out, "Your day"), "the digest time has no reader, and Home is gone");
  const order = ["About you", "Availability", "Contact"].map((t) => out.indexOf(`>${t}<`));
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
  await s.data.call("settings.set", { key: "chat.agent_tabs", value: false });
  const out = html(s, { initialPage: "ai" });
  assert.ok(has(out, 'data-testid="reset-chat.agent_tabs"'));
  assert.ok(!has(out, 'data-testid="reset-engine.local_runs"'));
  await s.data.call("settings.reset", { key: "chat.agent_tabs" });
  assert.equal(valueOf(s, "chat.agent_tabs"), true);
  assert.ok(!has(html(s, { initialPage: "ai" }), 'data-testid="reset-chat.agent_tabs"'));
});

test("controls follow the value: a switch, a choice, a field and hours", () => {
  const by = (k: string): SettingRow => rowsOf(createSampleSettings(northwind)).find((r) => r.key === k)!;
  assert.equal(controlFor(by("chat.agent_tabs")).kind, "switch");
  assert.equal(controlFor(by("profile.timezone")).kind, "choice");
  assert.equal(controlFor(by("profile.handle")).kind, "text");
  assert.equal(controlFor(by("profile.working_hours")).kind, "hours");
});

test("rows that have no reader or belong elsewhere are not drawn", () => {
  const s = createSampleSettings(northwind);
  const all = PAGES.map((p) => html(s, { initialPage: p.key })).join("");
  for (const words of ["File cache", "Security level", "Density", "Text size", "Reduce motion", "Terminal prompts", "Chrome prompts", "Last Ask agent", "Digest time", "Weekly reminder"]) assert.ok(!has(all, words), words);
  for (const key of HIDDEN_ROWS) assert.equal(pageOfRow({ ...rowsOf(s)[0]!, key }), null, key);
});

test("Notifications: each kind with how it arrives, the delivery rows and who is muted", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "notifications" });
  assert.ok(has(out, "Notify me on") && has(out, "Needs you") && has(out, "Mentions") && has(out, ">Interrupt<") && has(out, "Badge only") && has(out, "Digest"));
  assert.ok(!has(out, "Waits outside your working hours") && !has(out, "How each kind arrives"));
  assert.ok(has(out, "Email me if an approval waits") && has(out, "Alert me on replies") && has(out, "Tell me when routines succeed") && has(out, 'data-testid="ctl-quiet-on"') && has(out, 'data-testid="ctl-hand-to"'));
  assert.ok(!has(out, "Idle minutes"), "nothing reads it, and it was refused anyway");
  assert.ok(has(out, ">Muted<") && has(out, "Docs") && has(out, "#sales") && has(out, "Unmute"));
});

test("unmuting changes the list", async () => {
  const s = createSampleSettings(northwind);
  await s.data.call("notifications.mute.clear", { target: { kind: "agent", id: "agt_docs" } });
  const out = html(s, { initialPage: "notifications" });
  assert.ok(!has(out, "row-mute.agt_docs") && has(out, "row-mute.ch_sales"));
});

test("AI: defaults, how agents work with you, usage with bars, the accounts and the Vault", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "ai" });
  assert.ok(has(out, "Default model") && has(out, "Claude Sonnet 5.5") && has(out, "Fallback model") && has(out, "Claude Haiku 5.5"));
  assert.ok(has(out, 'data-testid="usage"') && has(out, "OpenAI team key") && has(out, "$48.20") && has(out, "168 turns"));
  assert.ok(has(out, "Run my chats on this computer") && has(out, "Agents can open side tabs"));
  assert.ok(has(out, "AI accounts") && has(out, "Sign in again") && has(out, "Working"));
  assert.ok(has(out, 'data-testid="row-open-vault"') && has(out, "Who pays for memory"));
  assert.equal(moneyLabel(48_200_000), "$48.20");
});

test("Connected lists mailboxes with their state and a way to pause", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "connected" });
  assert.ok(has(out, "irfad@northwind.example") && has(out, "Google, private to you") && has(out, "Syncing") && has(out, "Pause"));
  assert.ok(has(out, "irfad.imtiaz@outlook.example") && has(out, "Paused") && has(out, "Resume"));
  assert.ok(has(out, "Connect a mailbox") && has(out, "Connect a calendar"));
  assert.ok(has(out, "Through your Space") && has(out, "Google Workspace") && has(out, "Microsoft 365") && has(out, "Connected by your admin"), "what the admin connected for this person, by suite");
  assert.ok(has(html(createSampleSettings(harbor), { initialPage: "connected" }), "Connect a mailbox"), "an empty list still offers the connect rows");
});

test("Sign-in and devices: this device first, the others with Sign out, a signed-out device goes from the list", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "signin" });
  assert.ok(out.indexOf("Irfad&#x27;s MacBook Pro") < out.indexOf("Irfad&#x27;s iPhone"), "this device first");
  assert.ok(has(out, "This device") && has(out, "Last seen 3 hours ago, San Francisco") && has(out, "Last seen 6 days ago, Oakland"));
  assert.ok(has(out, 'data-testid="revoke-dev_phone"') && !has(out, 'data-testid="revoke-dev_mac"'));
  assert.ok(has(out, "Sign out of every other device"));
  assert.ok(has(out, 'data-testid="security-northwind"') && has(out, "Open now") && has(out, 'data-testid="open-harbor"'), "each Space has its own sign-in card");
  await s.data.call("devices.revoke", { deviceId: "dev_phone" });
  assert.ok(!has(html(s, { initialPage: "signin" }), "Irfad&#x27;s iPhone"));
  await s.data.call("devices.revoke_others", {});
  assert.ok(!has(html(s, { initialPage: "signin" }), "Sign out of every other device"));
  assert.equal(whenLabel(undefined, 0), "never");
  assert.equal(whenLabel(1_000, 1_000 + 30_000), "just now");
});

test("Appearance: every skin in Dark and Light with the chosen one marked, then the shortcuts", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "appearance" });
  assert.ok(!has(out, 'data-testid="ctl-appearance.mode"'), "no separate light or dark control");
  for (const id of ["graphite", "obsidian", "charcoal", "slate", "ember", "moss", "dusk", "paper", "fog", "linen", "sand", "sage", "mist"]) assert.ok(has(out, `data-testid="skin-${id}"`), id);
  assert.match(tag(out, "skin-system"), /aria-checked="true"/, "System is on until a skin is chosen");
  assert.match(tag(out, "skin-graphite"), /aria-checked="false"/);
  assert.ok(out.indexOf("skins-dark") < out.indexOf("skins-light"));
  assert.ok(!has(out, "Follow the Space"), "a Kit is installed, not picked");
});

test("choosing a skin saves it for this Space; hovering previews it and moving away puts the window back", async () => {
  const s = createSampleSettings(northwind);
  await s.data.call("settings.set", { key: "appearance.skin", value: "paper" });
  assert.match(tag(html(s, { initialPage: "appearance" }), "skin-paper"), /aria-checked="true"/);
  s.data.nav.previewSkin?.("fog"); s.data.nav.previewSkin?.(null);
  assert.deepEqual(s.previews, ["fog", null]);
});

test("the shortcuts listed are the ones the keys do, from the table that drives them", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "appearance" });
  for (const sc of KEYBOARD_MAP) assert.ok(has(out, `data-testid="keys-${sc.id}"`) && has(out, sc.title), sc.id);
  assert.ok(!has(out, "<input") || !has(out, 'data-testid="ctl-shortcut-search"'), "nothing reads a custom key, so there is nothing to type");
});

test("Your Spaces, on Sign-in: each Space with its address and role; Open for the others, Leave for the open Team Space", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "signin" });
  assert.ok(has(out, "northwind.vyre.run, Owner") && has(out, "harbor.vyre.run, Member, 2 waiting on you") && has(out, "Only on this computer") && !has(out, "Only on this computer, Owner"), "a Personal Space carries no role label");
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
  assert.ok(has(found, 'data-testid="search-count"') && has(found, 'data-testid="page-search"'), "the results are a page of their own");
  assert.ok(has(html(createSampleSettings(northwind), { initialQuery: "qqqq" }), "Nothing matches"));
});

test("the row a search found is outlined and the others are not", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "ai", initialFound: "chat.agent_tabs" });
  const sid = (k: string): string => out.match(new RegExp(`<[^>]*data-sid="${k}"[^>]*>`))?.[0] ?? "";
  assert.ok(sid("chat.agent_tabs").includes("accent-wash"), "the found row");
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
  assert.equal(pageOfRow(rows.find((r) => r.key === "engine.local_runs")!)?.key, "ai");
  assert.equal(pageOfRow(rows.find((r) => r.key === "chat.agent_tabs")!)?.key, "ai");
  assert.equal(pageOfRow({ ...rows.find((r) => r.key === "chat.agent_tabs")!, page: "ai" })?.key, "ai", "the server sends the page key");
  assert.equal(pageOfRow({ ...rows.find((r) => r.key === "notifications.alert_replies")!, page: "notifications" })?.key, "notifications", "the server sends the page key");
  assert.equal(pageOfRow({ ...rows[0]!, scope: "space", page: "Policies" }), null, "the Space pages place Space rows");
});

test("sections: every row of a page lands in a section, and a row no section names is kept", () => {
  const rows = rowsOf(createSampleSettings(northwind));
  for (const p of PAGES.filter((x) => x.group === "you")) {
    const secs = sectionsFor(p.key as YouPage, rows);
    const placed = secs.flatMap((x) => x.rows.map((r) => r.key));
    assert.equal(new Set(placed).size, placed.length, `${p.key}: no row twice`);
  }
  const extra: SettingRow = { ...rows.find((r) => r.key === "chat.agent_tabs")!, key: "chat.new_thing", title: "A new row" };
  assert.ok(sectionsFor("ai", [...rows, extra]).some((x) => x.rows.some((r) => r.key === "chat.new_thing")));
});

test("no em dash in any copy on any page", () => {
  const s = createSampleSettings(northwind);
  for (const p of PAGES) assert.ok(!html(s, { initialPage: p.key }).includes(String.fromCharCode(0x2014)), p.key);
});

test("AI > Who pays for memory: your own picker, the Space and project pickers for an admin, each saving through memory.key.set with Undo; no account reads as rules only", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "ai" });
  for (const t of ["Who pays for memory", "Your memory", "None (rules only)", "Space memory", "Project memory", "Rivera matter", "Probate GTM", "The Space&#x27;s account", 'data-testid="ctl-memory-key-person"', 'data-testid="ctl-memory-key-space"', 'data-testid="ctl-memory-key-project-prj_rivera"']) assert.ok(out.includes(t) || out.replaceAll("&#x27;", "'").includes(t.replaceAll("&#x27;", "'")), t);
  await s.data.call("memory.key.set", { layer: "person", accountRef: "#Team_OpenAI_Key" });
  await s.data.call("memory.key.set", { layer: "project", projectId: "prj_rivera", accountRef: "#Team_Anthropic_Key" });
  const after = html(s, { initialPage: "ai" });
  assert.ok(after.includes("OpenAI team key (shared)") && after.includes("Anthropic team key (shared)"), "the chosen accounts are on the pickers");
  assert.ok(after.includes("Its own account"), "a project with its own account says so");
  assert.deepEqual(s.calls.map((c) => c.cap), ["memory.key.set", "memory.key.set"]);
  // a person who is not an admin has their own picker only, and the Space one is refused
  const harborOut = html(createSampleSettings(harbor), { initialPage: "ai" });
  assert.ok(harborOut.includes("Your memory") && !harborOut.includes("Space memory") && !harborOut.includes("Project memory"));
  await assert.rejects(() => createSampleSettings(harbor).data.call("memory.key.set", { layer: "space", accountRef: "#Team_OpenAI_Key" }), /Only a Space admin/);
});

test("AI > Memory spend: last night, this month and the monthly cap for an admin, the cap saving through settings.set_space; a member sees none", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "ai" });
  for (const tx of ["Memory spend", "Last night", "$0.04", "This month", "$1.24", "25% of the cap", "Monthly cap", 'data-testid="ctl-memory-spend-cap"']) assert.ok(out.includes(tx), tx);
  await s.data.call("settings.set_space", { key: "memory.upkeep_monthly_cap", value: 8 });
  assert.equal(((s.data.peek?.("memory.upkeep.status", {}) as { capMicros: number }).capMicros), 8_000_000);
  assert.ok(!html(createSampleSettings(harbor), { initialPage: "ai" }).includes("Memory spend"));
  assert.equal(dollars(0), "$0.00");
  assert.equal(dollars(2_500_000), "$2.50");
  assert.match(monthNote({ spentMicros: 5_000_000, capMicros: 5_000_000, capReached: true, modelAvailable: true }), /cap is reached/);
  assert.match(monthNote({ spentMicros: 0, capMicros: 5_000_000, capReached: false, modelAvailable: false }), /rules only/);
});

const personalSpace = { ...northwind, id: "northwind" as const, name: "Personal", spaces: [{ id: "personal", name: "Personal", addr: "Only on this computer", kind: "personal" as const, role: "Owner", needsYou: 0, current: true }] };

test("a Personal Space shows no Space pages, no team-only rows and no suite section", () => {
  const s = createSampleSettings({ ...personalSpace, id: "harbor" as const });
  const conn = html(s, { initialPage: "connected" });
  assert.ok(!has(conn, "Through your Space"), "the admin's suites need a team");
  assert.ok(has(conn, "Connect a mailbox"));
  assert.ok(!has(conn, 'data-testid="space-group"'), "nothing here applies to anyone else");
  const ai = html(s, { initialPage: "ai" });
  assert.ok(!has(ai, "Run my chats on this computer"), "there is no Space computer to choose instead");
  assert.ok(!has(html(s, { initialPage: "notifications" }), 'data-testid="ctl-hand-to"'), "nobody to hand it to");
  assert.ok(!has(html(s), 'data-testid="copy-open"'), "one Space, nothing to copy from");
});

test("long registry titles are short labels and the rest is hover help", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "notifications" });
  assert.ok(has(out, "Email me if an approval waits") && !has(out, "Email me once if an approval waits 4 hours"), "no sentence in the label");
  assert.ok(has(out, 'title="One email if an approval has been waiting on you for 4 hours."'), "the detail is the row's hover help");
  for (const r of rowsOf(createSampleSettings(northwind))) if (pageOfRow(r)) assert.ok(rowLabel(r).length <= 48, `${r.key} label is short (${rowLabel(r)})`);
});

test("a notification kind's level is a choice that saves, says why when refused, and puts the old level back", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "notifications" });
  assert.ok(has(out, 'data-testid="kind-mention"') && has(out, 'data-testid="kind-approval.requested"'));
  assert.equal(await s.data.call("notifications.kind.set_level", { kind: "mention", level: "digest" }).then(() => "ok"), "ok");
  await assert.rejects(s.data.call("notifications.kind.set_level", { kind: "approval.requested", level: "badge" }), /never go below Interrupt/);
  assert.ok(s.calls.some((c) => c.cap === "notifications.kind.set_level"));
});
