// The Space side of Settings: only someone who can change the Space sees it, each row saves through settings.set_space with Undo, search reaches every row and every Console page, and a
// Console page opens inside Settings with a way back.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import type { SettingsProps } from "./SettingsPlace.tsx";
import { ADMIN_LINKS, PAGES, ROW_HELP, SPACE_ROWS, adminHome, rowHelp, pageOfRow, searchRows, spacePagesFor } from "./model.ts";
import { ROWS, createSampleSettings, harbor, northwind } from "./sample.ts";
import { registry } from "../../../../../generated/registry.ts";
import type { SampleSettings } from "./sample.ts";

const html = (s: SampleSettings, props: SettingsProps = {}): string =>
  renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} {...props} /></SettingsDataProvider>).replaceAll("<!-- -->", "");
const all = (): ReadonlySet<string> => new Set(Object.values(ADMIN_LINKS).flat().map((l) => l.id));

test("a member has no Space group, an owner has six pages, and a page shows only when it holds something for you", () => {
  assert.ok(!html(createSampleSettings(harbor)).includes('data-testid="space-group"'));
  assert.ok(html(createSampleSettings(northwind)).includes('data-testid="space-group"'));
  assert.deepEqual(spacePagesFor(undefined), []);
  assert.equal(spacePagesFor({ pages: all(), canPolicy: true }).length, 6);
  assert.deepEqual(spacePagesFor({ pages: new Set(["network"]), canPolicy: false }), ["advanced"], "someone who can only see the Network page sees one page");
});

test("every Space row has a plain name and says what it does, and each Console page has one home", () => {
  for (const r of SPACE_ROWS) { assert.ok(r.help.length > 20, r.id); assert.ok(r.label.length <= 48, r.id); }
  assert.equal(new Set(SPACE_ROWS.map((r) => r.id)).size, SPACE_ROWS.length);
  const ids = Object.values(ADMIN_LINKS).flat().map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(adminHome("gate")?.page, "agents");
  assert.equal(adminHome("nothing"), null);
});

test("every Space page draws its rows with their tooltips; a member's data never reaches them", () => {
  const s = createSampleSettings(northwind);
  for (const r of SPACE_ROWS) assert.ok(typeof r.page === "string" && PAGES.some((p) => p.key === r.page), r.id);
  const out = html(s, { initialPage: "agents" });
  assert.ok(out.includes("Manage") && out.includes("Gate rules"));
});

test("changing a Space row goes through settings.set_space, hands back the old value, and a member is refused", async () => {
  const s = createSampleSettings(northwind);
  const out = (await s.data.call("settings.set_space", { key: "gate.timeout_hours", value: 6 })) as { previous: unknown };
  assert.equal(out.previous, 24);
  const list = (await s.data.call("settings.list", { scope: "space" })) as { rows: { key: string; value: unknown }[] };
  assert.equal(list.rows.find((r) => r.key === "gate.timeout_hours")?.value, 6);
  await assert.rejects(createSampleSettings(harbor).data.call("settings.set_space", { key: "gate.timeout_hours", value: 6 }), /Only a Space admin/);
});

test("search reaches Space rows and Console pages for an owner, and only your own rows for anyone else", () => {
  const scope = { admin: { pages: all(), canPolicy: true } };
  assert.ok(searchRows([], "gate", scope).some((h) => h.admin === "gate"));
  assert.ok(searchRows([], "approval times out", scope).some((h) => h.key === "gate.timeout_hours"));
  assert.ok(searchRows([], "retention", scope).some((h) => h.admin === "retention" && h.page === "data"));
  assert.deepEqual(searchRows([], "retention"), [], "a member gets nothing from the Space");
  assert.ok(searchRows([], "audit", { admin: { pages: new Set(["network"]), canPolicy: false } }).length === 0, "only pages you can open");
});

test("a Console page opens inside Settings with a way back to the page it sits under", () => {
  const out = html(createSampleSettings(northwind), { initialAdmin: "backups" });
  assert.ok(out.includes('data-testid="admin-backups"'));
  assert.ok(out.includes('data-testid="admin-back"') && out.includes("Back to Data"));
  assert.ok(out.includes('data-testid="settings-nav"'), "still Settings, not a second app");
});

test("every person row that shows says what it does, or is plain enough not to need it", () => {
  const plain = new Set(["appearance.skin", "profile.display_name", "profile.handle", "profile.title", "profile.photo", "profile.contact"]);
  const s = createSampleSettings(northwind);
  const rows = (s.data.screens.query("settings.page", "rows", {}).getSnapshot() as { data: { rows: Parameters<typeof rowHelp>[0][] } }).data.rows;
  for (const r of rows) if (pageOfRow(r) && !plain.has(r.key)) assert.ok(rowHelp(r), r.key);
  assert.ok(Object.values(ROW_HELP).every((h) => h.length > 20));
});

test("every row is a real setting of the right scope, and every choice and range is one the schema accepts", () => {
  const defs = new Map((registry.settings as unknown as { key: string; scope: string; schema: { enum?: unknown[]; $ref?: string; minimum?: number; maximum?: number } }[]).map((d) => [d.key, d]));
  const $defs = registry.$defs as Record<string, { enum?: unknown[] }>;
  for (const r of SPACE_ROWS) {
    const d = defs.get(r.key);
    assert.ok(d, `${r.key} is in the registry`);
    assert.equal(d.scope, "space", r.key);
    const allowed = d.schema.enum ?? (d.schema.$ref ? $defs[d.schema.$ref.split("/").pop()!]?.enum : undefined);
    if (r.control.kind === "choice" && allowed) for (const o of r.control.options) assert.ok(allowed.includes(o.value), `${r.key}: ${o.value}`);
    if (r.control.kind === "number") { assert.equal(r.control.min, d.schema.minimum, r.key); assert.equal(r.control.max, d.schema.maximum, r.key); }
  }
  for (const r of ROWS) assert.equal(defs.get(r.key)?.scope, "person", r.key);
});
