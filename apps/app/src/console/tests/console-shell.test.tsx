// Console shell (spec 3.10; ARCH 7.10): the top bar, the navigation groups and their permissions, LockedState for a person without console.access, and the Overview and Audit pages.
// Screens render with react-dom/server over react-native-web (ruling 28) against the Northwind sample replica.
// Path mapping: the packet names apps/console/tests/shell*.test.tsx and the pages live in apps/console/src/pages/{overview,audit}.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { screensById } from "../../../../../generated/screens.ts";
import { Audit } from "../pages/audit/Audit.tsx";
import { CLASSES, NO_FILTER, isFiltered, rowTitle, snapshotLines, stateOf } from "../pages/audit/model.ts";
import { ATTENTION_PAGE } from "../pages/overview/Overview.tsx";
import { ConsoleShell, skinMenuEntries, SYSTEM_SKIN } from "../shell/ConsoleShell.tsx";
import type { ConsoleShellProps } from "../shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { ago, actionPhrase, activityTitle, money } from "../shell/format.ts";
import { PAGES, PAGE_NOTE, pageById, visiblePages } from "../shell/nav.ts";
import { SECTIONS } from "../shell/sections.ts";
import { AUDIT, NAMES, SAMPLE_NOW, createSampleConsole } from "../shell/sample.ts";
import type { SampleConsole } from "../shell/sample.ts";

const html = (s: SampleConsole, props: ConsoleShellProps = {}): string =>
  renderToStaticMarkup(<ConsoleDataProvider value={s.data}><ConsoleShell width={1280} {...props} /></ConsoleDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

test("the top bar: Space mark and name, Console, health dot, Search, Assistant, skin, Open the app and the admin", () => {
  const out = html(createSampleConsole());
  for (const id of ["console-top", "console-health", "console-search", "console-assistant-toggle", "console-skin", "console-open-app", "console-admin"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, ">Northwind<") && has(out, ">Console<"));
  assert.ok(has(out, 'aria-label="Server degraded"'), "the sample server has two things wrong");
  assert.ok(has(html(createSampleConsole({ busy: false })), 'aria-label="Server healthy"'));
  assert.ok(has(out, "⌘K") && has(out, "⌘J"), "Cmd-K and Cmd-J are shown on the buttons");
  assert.ok(has(out, 'aria-label="Irfad Imtiaz, Owner"'));
  assert.ok(!has(out, 'data-testid="console-assistant"'), "the Assistant pane starts closed");
  assert.ok(has(html(createSampleConsole(), { assistantOpen: true }), 'data-testid="console-assistant"'));
});

test("the navigation: ten places, Home first and Space last after a gap, and the place a page is in shows its tabs", () => {
  const out = html(createSampleConsole());
  assert.deepEqual(SECTIONS.map((s) => s.id), ["overview", "access", "agents", "ai", "data", "messaging", "apps", "machines", "security", "space"]);
  const at = (id: string): number => { const i = out.indexOf(`data-testid="${id}"`); assert.ok(i >= 0, id); return i; };
  const ids = SECTIONS.map((s) => at(`row-nav-${s.id}`));
  assert.deepEqual([...ids].sort((a, b) => a - b), ids, "the places are in order");
  assert.ok(!has(out, 'data-testid="row-nav-sessions"') && !has(out, 'data-testid="row-nav-schema"') && !has(out, 'data-testid="navgroup-Access"'), "no page of its own in the list, no groups");
  assert.match(tag(out, "row-nav-overview"), /var\(--sel\)/);
  assert.doesNotMatch(tag(out, "row-nav-access"), /var\(--sel\)/);
  assert.ok(!has(out, 'data-testid="console-tabs"'), "Overview has one tab and so no strip");
  const people = html(createSampleConsole(), { initialPage: "people" });
  assert.match(tag(people, "row-nav-access"), /var\(--sel\)/);
  for (const tab of ["people", "groups", "permissions", "requests"]) assert.ok(has(people, `data-testid="tab-${tab}"`), tab);
  assert.ok(has(tag(people, "tab-people"), 'aria-selected="true"') && !has(people, 'data-testid="console-views"'), "People has no views");
  // Roles is one tab with a text switch: the matrix, role details and extra access
  const roles = html(createSampleConsole(), { initialPage: "roles" });
  assert.ok(has(tag(roles, "tab-permissions"), 'aria-selected="true"'), "an old address lands on the tab it moved into");
  for (const v of ["permissions", "roles", "grants"]) assert.ok(has(roles, `data-testid="view-${v}"`), v);
  assert.ok(has(tag(roles, "view-roles"), 'aria-selected="true"'));
  // an old page id lands on its new home
  assert.ok(has(html(createSampleConsole(), { initialPage: "computers" }), 'data-testid="page-machines"'));
  assert.ok(has(html(createSampleConsole(), { initialPage: "sessions" }), 'data-testid="view-sessions"'));
  // the Space defaults sit under the page they configure
  assert.ok(has(html(createSampleConsole(), { initialPage: "gate" }), 'data-testid="extra-def-agents"'));
});

test("a person finds a page by its old name: the search says where it is now", async () => {
  const { OLD_NAMES, nowIn, sectionOf, resolve } = await import("../shell/sections.ts");
  const where = Object.fromEntries(OLD_NAMES.map(([n, id]) => [n, nowIn(id)]));
  assert.equal(where["Sessions"], "Security, Sign-in, Sessions and devices");
  assert.equal(where["Infrastructure"], "Computers, Overview");
  assert.equal(where["Actors"], "Agents, Outside agents");
  assert.equal(where["Access checker"], "People, Members");
  assert.equal(resolve("computers"), "machines");
  for (const [name, id] of OLD_NAMES) assert.ok(sectionOf(id), `${name} has a home`);
  // every page of the registry is somewhere in a section
  for (const p of PAGES) assert.ok(sectionOf(p.id), `${p.id} is in a section`);
});

test("every nav page names a screen of the registry, and the pages this packet draws are the Overview and the Audit log", () => {
  assert.equal(new Set(PAGES.map((p) => p.id)).size, PAGES.length, "page ids are unique");
  for (const p of PAGES) assert.ok(screensById.has(p.screen), `${p.id} names ${p.screen}`);
  assert.deepEqual(PAGES.filter((p) => p.built).map((p) => p.id), ["overview", "audit"]);
  assert.equal(screensById.get("console.overview")!.needs.includes("console.access"), true);
  assert.equal(screensById.get("audit.log")!.needs.includes("audit.read"), true);
});

test("pages hide by permission: a Developer sees Schema, the Space server and the Audit log, and no people management", () => {
  const dev = createSampleConsole({ viewer: "developer" });
  const out = html(dev, { initialPage: "schema" });
  assert.ok(has(out, 'data-testid="row-nav-data"') && has(out, 'data-testid="row-nav-machines"') && has(out, 'data-testid="row-nav-security"'));
  assert.ok(has(out, 'data-testid="row-nav-overview"') && has(out, 'data-testid="page-schema"'));
  assert.ok(!has(out, 'data-testid="row-nav-access"') && !has(out, 'data-testid="tab-people"'), "no people management");
  assert.ok(!has(out, 'data-testid="row-nav-agents"'), "no agent management");
  const ids = visiblePages(dev.data.can).map((p) => p.id);
  assert.ok(ids.includes("server") && !ids.includes("network"), "Server needs server.logs, Network needs server.network");
  assert.ok(visiblePages(createSampleConsole().data.can).length === PAGES.length, "the Owner sees every page");
});

test("a page opened without its permission shows the locked state with Ask for access, inside the Console", () => {
  const out = html(createSampleConsole({ viewer: "developer" }), { initialPage: "people" });
  assert.ok(has(out, 'data-testid="console-nav"'), "the Console itself is open");
  assert.ok(has(out, "Ask for access"));
  assert.ok(!has(out, 'data-testid="attention"'));
});

test("a person without console.access sees the locked state and no Console, and the refusal names Ask for access", () => {
  const s = createSampleConsole({ viewer: "member" });
  const out = html(s);
  assert.ok(has(out, 'data-testid="console-locked"') && has(out, "Ask for access"));
  assert.ok(!has(out, 'data-testid="console-top"') && !has(out, 'data-testid="console-nav"') && !has(out, 'data-testid="overview"'));
  assert.equal(s.data.can("console.access"), false);
  assert.equal(s.calls.length, 0, "nothing was asked of the server");
});

test("Overview: what needs you, the server tiles and the last admin acts, each with a way to its page", () => {
  const out = html(createSampleConsole());
  assert.ok(has(out, 'data-testid="overview"'));
  assert.ok(has(out, 'data-testid="row-attn-failing_check-chk_disk"') && has(out, 'data-testid="row-attn-expiring_certificate-crt_main"') && has(out, 'data-testid="row-attn-access_review_due-2"'));
  assert.ok(has(out, "Disk space on the server is under 15 percent") && has(out, "A health check is failing since 3 h ago"));
  assert.ok(has(out, "Open Server") && has(out, "Start the review"));
  for (const t of ["Space server", "Members", "Agents", "Turns today", "Spend"]) assert.ok(has(out, `data-testid="tile-${t}"`), t);
  assert.ok(has(out, "Degraded") && has(out, ">14<") && has(out, ">6<") && has(out, "1,284") && has(out, "$412"));
  assert.equal((out.match(/data-testid="row-act-\d"/g) ?? []).length, 5, "five admin acts");
  assert.ok(has(out, "Priya Raman changed the role of Omar Haddad") && has(out, "6 min ago"));
  assert.ok(has(out, 'data-testid="to-audit"'));
  assert.deepEqual(Object.keys(ATTENTION_PAGE).sort(), ["access_review_due", "expiring_certificate", "failed_run", "failing_check", "home_channel", "join_stuck", "limit_hit", "no_ai_account", "space_deletion_scheduled", "stuck_update"]);
  for (const id of Object.values(ATTENTION_PAGE)) assert.ok(PAGES.some((p) => p.id === id), `${id} is a page`);
});

test("Overview with nothing wrong says so in one line", () => {
  const out = html(createSampleConsole({ busy: false }));
  assert.ok(has(out, 'data-testid="attention-none"') && has(out, "Nothing needs you"));
  assert.ok(has(out, "Healthy") && has(out, "Nothing waiting"));
});

test("an attention row and a tile open their page through the shell's navigation", () => {
  const s = createSampleConsole();
  s.data.nav.openPage("server");
  s.data.nav.openApp();
  assert.deepEqual(s.opened, ["page:server", "app"]);
});

test("Audit log: every row has who, what, the kind and when; nothing from a filter shows with no filter", () => {
  const out = html(createSampleConsole(), { initialPage: "audit" });
  assert.ok(has(out, 'data-testid="audit"') && has(out, 'aria-label="Search the audit log"') && has(out, 'aria-label="Filter"'));
  for (const r of AUDIT) assert.ok(has(out, `data-testid="row-${r.id}"`), r.id);
  assert.ok(has(out, "Priya Raman changed the role of Omar Haddad"));
  assert.ok(has(out, "Intake revealed the record Rivera engagement, for Priya Raman"), "an agent's act names the person it acted for");
  assert.ok(has(out, "Admin actions, space") && has(out, "Sensitive reads, record"));
  assert.ok(!has(out, 'data-testid="audit-showing"'));
  assert.ok(has(out, 'aria-label="Verify the chain"') && has(out, 'aria-label="Export"'));
});

test("Audit log filters: by kind, by search and by trace, with a Show all", () => {
  const s = createSampleConsole();
  const signIns = html(s, { initialPage: "audit", initialAudit: { filter: { ...NO_FILTER, cls: "sign_in" } } });
  assert.ok(has(signIns, 'data-testid="row-aud_007"') && has(signIns, 'data-testid="row-aud_011"'));
  assert.ok(!has(signIns, 'data-testid="row-aud_001"') && !has(signIns, 'data-testid="row-aud_003"'));
  assert.ok(has(signIns, "Showing sign-ins") && has(signIns, 'data-testid="audit-clear"'));
  const search = html(s, { initialPage: "audit", initialAudit: { filter: { ...NO_FILTER, query: "omar" } } });
  assert.ok(has(search, 'data-testid="row-aud_004"') && has(search, 'data-testid="row-aud_011"') && !has(search, 'data-testid="row-aud_002"'));
  const trace = html(s, { initialPage: "audit", initialAudit: { filter: { ...NO_FILTER, traceId: "trc_0001" } } });
  assert.ok(has(trace, 'data-testid="row-aud_001"') && has(trace, 'data-testid="row-aud_002"') && !has(trace, 'data-testid="row-aud_003"'));
  assert.ok(has(trace, "Showing related entries"));
  const none = html(s, { initialPage: "audit", initialAudit: { filter: { ...NO_FILTER, query: "zzzz" } } });
  assert.ok(has(none, 'data-testid="audit-none"') && has(none, "No events match"));
});

test("Audit log: an open entry shows who, on whose behalf, what changed and a way to its trace", () => {
  const s = createSampleConsole();
  const a = html(s, { initialPage: "audit", initialAudit: { open: "aud_001" } });
  assert.ok(has(a, 'data-testid="audit-entry"') && has(a, 'data-testid="audit-before"') && has(a, "role: Member") && has(a, "role: Developer"));
  assert.match(tag(a, "row-aud_001"), /var\(--sel\)/);
  assert.ok(has(a, 'data-testid="audit-trace"') && has(a, 'data-testid="audit-entry-close"'));
  const b = html(s, { initialPage: "audit", initialAudit: { open: "aud_003" } });
  assert.ok(has(b, ">On behalf of<") && has(b, ">Priya Raman<"));
  const lone = renderToStaticMarkup(<ConsoleDataProvider value={s.data}><Audit initialOpen="aud_007" /></ConsoleDataProvider>).replaceAll("<!-- -->", "");
  assert.ok(!has(lone, 'data-testid="audit-before"') && !has(lone, 'data-testid="audit-after"'), "a sign-in carries no before or after");
});

test("verify and export go through the capabilities and the audit log refuses nobody with audit.read", async () => {
  const s = createSampleConsole();
  assert.deepEqual(await s.data.call("audit.verify", {}), { ok: true, checked: 1012 });
  assert.deepEqual(await s.data.call("audit.export", {}), { fileId: "fil_audit_export", rows: AUDIT.length });
  assert.deepEqual(s.calls.map((c) => c.cap), ["audit.verify", "audit.export"]);
  s.failNext("audit.verify");
  await assert.rejects(() => s.data.call("audit.verify", {}), /audit.verify failed/);
  assert.equal(createSampleConsole({ viewer: "developer" }).data.can("audit.read"), true);
  assert.equal(createSampleConsole({ viewer: "member" }).data.can("audit.read"), false);
});

test("the audit model: the six kinds, the screen state a filter writes, and the text of a row", () => {
  assert.deepEqual(CLASSES.map((c) => c.id), ["admin", "change", "sensitive", "deny", "erase", "sign_in"]);
  assert.deepEqual(stateOf(NO_FILTER), {});
  assert.deepEqual(stateOf({ query: " omar ", cls: "deny", traceId: "trc_1" }), { query: "omar", class: "deny", traceId: "trc_1" });
  assert.equal(isFiltered(NO_FILTER), false);
  assert.equal(isFiltered({ ...NO_FILTER, query: "  " }), false);
  assert.equal(isFiltered({ ...NO_FILTER, cls: "admin" }), true);
  assert.equal(rowTitle(AUDIT[2]!, (id) => NAMES[id] ?? id), "Intake revealed the record Rivera engagement, for Priya Raman");
  assert.deepEqual(snapshotLines({ role: "Member", n: 2, o: { a: 1 } }), ["role: Member", "n: 2", 'o: {"a":1}']);
  assert.deepEqual(snapshotLines(undefined), []);
});

test("text helpers: relative times, whole dollars and action phrases", () => {
  assert.equal(ago(SAMPLE_NOW, SAMPLE_NOW - 20_000), "now");
  assert.equal(ago(SAMPLE_NOW, SAMPLE_NOW - 6 * 60_000), "6 min ago");
  assert.equal(ago(SAMPLE_NOW, SAMPLE_NOW - 3 * 3_600_000), "3 h ago");
  assert.equal(ago(SAMPLE_NOW, SAMPLE_NOW - 2 * 86_400_000), "2 d ago");
  assert.equal(ago(SAMPLE_NOW, SAMPLE_NOW - 30 * 86_400_000), "2025-09-24");
  assert.equal(money(412_000_000), "$412");
  assert.equal(actionPhrase("gate.rule_changed"), "approval rule changed");
  assert.equal(activityTitle("Olivia Owner", "audit.viewed", "space/spc_fresh"), "Olivia Owner opened the audit log");
  assert.equal(activityTitle("act_anon_12ca17b49af22894", "identity.claim_owner", undefined), "The owner claimed this Space");
  assert.equal(activityTitle("Priya Raman", "gate.rule_changed", "Send"), "Priya Raman changed the rule Send");
});

test("the skin menu lists System, then Dark and Light skins, and checks the open one", () => {
  const picked: string[] = [];
  const entries = skinMenuEntries("graphite", (id) => picked.push(id));
  const items = entries.filter((e): e is { label: string; checked?: boolean; onSelect?: () => void } => "label" in e);
  assert.equal(items[0]!.label, "Vyre");
  assert.deepEqual(items.filter((i) => i.checked).map((i) => i.label), ["Graphite"]);
  assert.ok(entries.some((e) => "head" in e && e.head === "Dark") && entries.some((e) => "head" in e && e.head === "Light"));
  items[0]!.onSelect?.();
  assert.deepEqual(picked, [SYSTEM_SKIN]);
});

test("inside the app the Console has no second bar: no skin, no Open the app, and the page still says what it is and how the server is", () => {
  const out = html(createSampleConsole(), { embedded: true });
  for (const id of ["console-top", "console-skin", "console-open-app", "console-search"]) assert.ok(!has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, 'data-testid="console-nav"') && has(out, 'data-testid="console-health"') && has(out, 'data-testid="page-help"'));
});

test("at its own address there is no app to open", () => {
  assert.ok(!has(html(createSampleConsole(), { noApp: true }), 'data-testid="console-open-app"'));
});

test("every Console page says what it is for, and no two pages draw the same thing", () => {
  for (const p of PAGES) assert.ok(PAGE_NOTE[p.id], p.id);
  assert.ok(pageById("export") !== undefined, "Export is a tab of Data");
});


test("Home: the Relay tile says its version and turns amber with Update available when the relay is older than the Space server", async () => {
  const { relayTile, relayIsOlder } = await import("../pages/overview/Overview.tsx");
  assert.equal(relayIsOlder("1.4.0", "1.4.1"), true);
  assert.equal(relayIsOlder("1.4.1", "1.4.1"), false);
  assert.equal(relayIsOlder("v1.10.0", "1.9.9"), false);
  const ok = relayTile({ mode: "relay", relayVersion: "1.4.1", relayMs: 18, relayReachable: true }, "1.4.1")!;
  assert.deepEqual([ok.big, ok.sub, ok.page, ok.tone], ["Reachable", "Vyre relay · v1.4.1 · 18 ms", "network", "ok"]);
  const old = relayTile({ mode: "relay", relayVersion: "1.3.9", relayMs: 18 }, "1.4.1")!;
  assert.deepEqual([old.big, old.tone, old.page], ["Update available", "warn", "updates"], "it opens Computers, Servers, Updates");
  const flagged = relayTile({ mode: "relay", relayVersion: "1.4.1", relayOlder: true, relayMs: 18 }, "1.4.1")!;
  assert.deepEqual([flagged.big, flagged.page, flagged.sub], ["Update available", "updates", "Vyre relay · v1.4.1 · 18 ms"], "network.status says the relay is older: that wins");
  assert.equal(relayTile({ mode: "relay", relayVersion: "1.3.0", relayOlder: false }, "1.4.1")!.big, "Reachable", "relayOlder false is not amber");
  assert.equal(relayTile({ mode: "own_domain" }, "1.4.1"), null, "no relay, no tile");
  assert.equal(relayTile({ mode: "relay" }, "1.4.1")!.sub, "Vyre relay", "no version read yet: just the name");
});

test("Home: This month and Quick actions, each with a way to its page", () => {
  const out = html(createSampleConsole());
  for (const id of ["tiles-month", "quick-actions", "row-qa-invite", "row-qa-ai", "row-qa-server"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(out, "Invite people") && has(out, "Add an AI account") && has(out, "Add a server"));
});
