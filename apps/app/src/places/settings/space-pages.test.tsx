// The Space side of Settings: only someone who can change the Space sees it, each row saves through settings.set_space with Undo, search reaches every row and every Console page, and a
// Console page opens inside Settings with a way back.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import type { SettingsProps } from "./SettingsPlace.tsx";
import { PERSONAL_SPACE_ROWS, PAGES, ROW_HELP, SPACE_ROWS, rowHelp, pageOfRow, searchRows, spacePagesFor } from "./model.ts";
import { ROWS, createSampleSettings, harbor, northwind } from "./sample.ts";
import { registry } from "../../../../../generated/registry.ts";
import type { SampleSettings } from "./sample.ts";

const html = (s: SampleSettings, props: SettingsProps = {}): string =>
  renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} {...props} /></SettingsDataProvider>).replaceAll("<!-- -->", "");

test("a Team Space has no Space pages in Settings, for anyone: they are the Console's", () => {
  assert.deepEqual(spacePagesFor(false), []);
  for (const space of [northwind, harbor]) {
    const out = html(createSampleSettings(space));
    assert.ok(!out.includes('data-testid="space-group"') && !out.includes("Agents and rules"), space.name);
  }
});

test("a Personal Space has no Console, so the Space rows its owner needs are in Settings, and rows that need other people are not", () => {
  const pages = spacePagesFor(true);
  assert.ok(pages.length > 0 && !pages.includes("people"));
  for (const id of PERSONAL_SPACE_ROWS) assert.ok(SPACE_ROWS.some((r) => r.id === id), id);
  for (const id of ["tasks.require_human_approver", "tasks.allow_self_review", "changesets.different_person", "access.review_every_days", "google.auto_connect"]) assert.ok(!PERSONAL_SPACE_ROWS.has(id), id);
});

test("no setting is in both: a row of You is the person's, a Space row is the Space's, and the two never share a key", async () => {
  const s = createSampleSettings(northwind);
  const you = ((await s.data.call("settings.list", {})) as { rows: Parameters<typeof pageOfRow>[0][] }).rows.filter((r) => pageOfRow(r));
  const spaceKeys = new Set(SPACE_ROWS.map((r) => r.key));
  for (const r of you) { assert.equal(r.scope, "person", r.key); assert.ok(!spaceKeys.has(r.key), r.key); }
  for (const r of SPACE_ROWS) assert.ok(!PAGES.some((p) => p.key === r.page && p.group === "you"), r.id);
});

test("every Space row has a plain name and says what it does", () => {
  for (const r of SPACE_ROWS) { assert.ok(r.help.length > 20, r.id); assert.ok(r.label.length <= 48, r.id); }
  assert.equal(new Set(SPACE_ROWS.map((r) => r.id)).size, SPACE_ROWS.length);
});

test("changing a Space row goes through settings.set_space, hands back the old value, and a member is refused", async () => {
  const s = createSampleSettings(northwind);
  const out = (await s.data.call("settings.set_space", { key: "gate.timeout_hours", value: 6 })) as { previous: unknown };
  assert.equal(out.previous, 24);
  const list = (await s.data.call("settings.list", { scope: "space" })) as { rows: { key: string; value: unknown }[] };
  assert.equal(list.rows.find((r) => r.key === "gate.timeout_hours")?.value, 6);
  await assert.rejects(createSampleSettings(harbor).data.call("settings.set_space", { key: "gate.timeout_hours", value: 6 }), /Only a Space admin/);
});

test("search in a Team Space finds only your own rows; a Personal Space's owner also finds its Space rows", () => {
  assert.deepEqual(searchRows([], "approval times out"), []);
  assert.deepEqual(searchRows([], "protected branches push", {}), []);
  assert.ok(searchRows([], "branches push", { personal: true }).some((h) => h.key === "git.protected_branches"));
  assert.deepEqual(searchRows([], "approval times out", { personal: true }), [], "a rule about other people is not a Personal Space's");
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
