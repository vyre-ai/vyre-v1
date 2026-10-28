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
import { ago, actionPhrase, money } from "../shell/format.ts";
import { GROUPS, PAGES, visiblePages } from "../shell/nav.ts";
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

test("the navigation has the seven groups, Overview first, Audit log and Space last; Access is open and the others are folded", () => {
  const out = html(createSampleConsole());
  assert.deepEqual([...GROUPS], ["Access", "Agents and actors", "Data", "AI", "Comms", "Integrations", "Infrastructure"]);
  for (const g of GROUPS) assert.ok(has(out, `data-testid="navgroup-${g}"`), g);
  const at = (id: string): number => { const i = out.indexOf(`data-testid="${id}"`); assert.ok(i >= 0, id); return i; };
  assert.ok(at("row-nav-overview") < at("navgroup-Access") && at("navgroup-Access") < at("row-nav-people") && at("row-nav-people") < at("navgroup-Agents and actors"));
  assert.ok(at("navgroup-Infrastructure") < at("row-nav-audit") && at("row-nav-audit") < at("row-nav-space"));
  assert.ok(has(out, 'data-testid="row-nav-sessions"'), "Access holds Sessions and devices");
  assert.ok(!has(out, 'data-testid="row-nav-schema"'), "Data is folded");
  assert.ok(has(tag(out, "navgroup-Access"), 'aria-expanded="true"') && has(tag(out, "navgroup-Data"), 'aria-expanded="false"'));
  assert.match(tag(out, "row-nav-overview"), /var\(--sel\)/);
  assert.doesNotMatch(tag(out, "row-nav-people"), /var\(--sel\)/);
  const data = html(createSampleConsole(), { initialPage: "schema" });
  assert.ok(has(data, 'data-testid="row-nav-schema"') && has(data, 'data-testid="page-schema"'), "opening a page unfolds its group");
  assert.match(tag(data, "row-nav-schema"), /var\(--sel\)/);
});

test("every nav page names a screen of the registry, and the pages this packet draws are the Overview and the Audit log", () => {
  assert.equal(new Set(PAGES.map((p) => p.id)).size, PAGES.length, "page ids are unique");
  for (const p of PAGES) assert.ok(screensById.has(p.screen), `${p.id} names ${p.screen}`);
  assert.deepEqual(PAGES.filter((p) => p.built).map((p) => p.id), ["overview", "audit"]);
  assert.equal(screensById.get("console.overview")!.needs.includes("console.access"), true);
  assert.equal(screensById.get("audit.log")!.needs.includes("audit.read"), true);
});

test("pages hide by permission: a Developer sees Schema, Server and the Audit log, and no people management", () => {
  const dev = createSampleConsole({ viewer: "developer" });
  const out = html(dev, { initialPage: "schema" });
  assert.ok(has(out, 'data-testid="navgroup-Data"') && has(out, 'data-testid="row-nav-schema"'));
  assert.ok(has(out, 'data-testid="navgroup-Infrastructure"'));
  assert.ok(has(out, 'data-testid="row-nav-audit"') && has(out, 'data-testid="row-nav-overview"'));
  assert.ok(!has(out, 'data-testid="navgroup-Access"') && !has(out, 'data-testid="row-nav-people"'), "no people management");
  assert.ok(!has(out, 'data-testid="navgroup-AI"') && !has(out, 'data-testid="navgroup-Comms"'));
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
  for (const t of ["Server", "Members", "Agents", "Turns today", "Spend this month"]) assert.ok(has(out, `data-testid="tile-${t}"`), t);
  assert.ok(has(out, "Degraded") && has(out, ">14<") && has(out, ">6<") && has(out, "1,284") && has(out, "$412"));
  assert.equal((out.match(/data-testid="row-act-\d"/g) ?? []).length, 5, "five admin acts");
  assert.ok(has(out, "Priya Raman role changed Omar Haddad") && has(out, "6 min ago"));
  assert.ok(has(out, 'data-testid="to-audit"'));
  assert.deepEqual(Object.keys(ATTENTION_PAGE).sort(), ["access_review_due", "expiring_certificate", "failed_run", "failing_check", "limit_hit", "stuck_update"]);
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
  assert.ok(has(out, "Priya Raman role changed Omar Haddad"));
  assert.ok(has(out, "Intake record revealed Rivera engagement, for Priya Raman"), "an agent's act names the person it acted for");
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
  assert.ok(has(trace, "Showing one trace"));
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
  assert.equal(rowTitle(AUDIT[2]!, (id) => NAMES[id] ?? id), "Intake record revealed Rivera engagement, for Priya Raman");
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
  assert.equal(actionPhrase("gate.rule_changed"), "gate rule changed");
});

test("the skin menu lists System, then Dark and Light skins, and checks the open one", () => {
  const picked: string[] = [];
  const entries = skinMenuEntries("graphite", (id) => picked.push(id));
  const items = entries.filter((e): e is { label: string; checked?: boolean; onSelect?: () => void } => "label" in e);
  assert.equal(items[0]!.label, "System");
  assert.deepEqual(items.filter((i) => i.checked).map((i) => i.label), ["Graphite"]);
  assert.ok(entries.some((e) => "head" in e && e.head === "Dark") && entries.some((e) => "head" in e && e.head === "Light"));
  items[0]!.onSelect?.();
  assert.deepEqual(picked, [SYSTEM_SKIN]);
});
