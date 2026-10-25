// P-L9f_06c: Settings as in the prototype (the lead's screenshot audit). Path mapping: the packet lists only this test; the screen files it fixes are the lane's own settings place files
// (SettingsPlace, pages-a, pages-b, rows, ui, model, sample) and the shots mount and targets for P-L9f_06c.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "../data.tsx";
import { SettingsPlace } from "../SettingsPlace.tsx";
import type { SettingsProps } from "../SettingsPlace.tsx";
import { searchRows } from "../model.ts";
import type { SettingRow } from "../model.ts";
import { createSampleSettings, harbor, northwind } from "../sample.ts";
import type { SampleSettings } from "../sample.ts";

const html = (s: SampleSettings, props: SettingsProps = {}): string =>
  renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} {...props} /></SettingsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const rowsOf = (s: SampleSettings): SettingRow[] => (s.data.screens.query("settings.page", "rows", {}).getSnapshot() as { data: { rows: SettingRow[] } }).data.rows;

test("search: a query opens a Search page with the count and each row with its page, the page list stays", () => {
  const out = html(createSampleSettings(northwind), { initialQuery: "density" });
  assert.ok(has(out, 'data-testid="page-search"') && has(out, 'data-testid="search-results"'));
  assert.ok(has(out, "1 setting<") && has(out, "Density") && has(out, "Comfortable or compact"));
  assert.ok(has(out, 'data-testid="row-hit-appearance.density"') && has(out, ">Appearance<"));
  assert.ok(has(out, 'data-testid="row-page-profile"') && has(out, "Everywhere"), "the page list stays on the left");
});

test("search: drawn rows (sign-in) are found too, and nothing found says so with the query", () => {
  const rows = rowsOf(createSampleSettings(northwind));
  const hits = searchRows(rows, "authenticator");
  assert.deepEqual(hits.map((h) => [h.title, h.page]), [["Authenticator app", "signin"]]);
  assert.ok(searchRows(rows, "2fa").some((h) => h.key === "signin.totp"));
  assert.ok(has(html(createSampleSettings(northwind), { initialQuery: "qqqq" }), 'Nothing matches &quot;qqqq&quot;'));
});

test("search on a phone: the results take the place of the page list under the search box", () => {
  const out = html(createSampleSettings(northwind), { initialQuery: "text", width: 390 });
  assert.ok(has(out, 'data-testid="settings-nav"') && has(out, 'data-testid="search-results"') && !has(out, 'data-testid="row-page-profile"'));
});

test("Appearance: Density, Text size, Reduce motion at the top, then Skin with the preview, System, Dark and Light, and the line under them", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "appearance" });
  for (const id of ["ctl-appearance.density", "ctl-appearance.text_size", "ctl-appearance.reduce_motion", "skin-preview", "skins-system", "skins-dark", "skins-light", "skin-system"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.match(tag(out, "ctl-appearance.density-comfortable"), /aria-checked="true"/);
  assert.match(tag(out, "ctl-appearance.density-compact"), /aria-checked="false"/);
  assert.ok(has(out, 'data-testid="ctl-appearance.text_size-value"') && has(out, ">100%<"));
  assert.match(tag(out, "ctl-appearance.text_size"), /aria-valuenow="100"/);
  assert.ok(out.indexOf("ctl-appearance.density") < out.indexOf("skin-preview") && out.indexOf("skin-preview") < out.indexOf("skins-system") && out.indexOf("skins-system") < out.indexOf("skins-dark") && out.indexOf("skins-dark") < out.indexOf("skins-light"));
  assert.ok(has(out, "Just for you, in Northwind") && has(out, "Paper by day, Graphite by night") && has(out, "Weekly report"));
  for (const gone of ["Light or dark", "Skin for this Space", "Hover a tile to try it", "A Kit sets the rail"]) assert.ok(!has(out, gone), `no "${gone}"`);
});

test("Appearance: density, text size and reduce motion save as they are made", async () => {
  const s = createSampleSettings(northwind);
  await s.data.call("settings.set", { key: "appearance.density", value: "compact" });
  await s.data.call("settings.set", { key: "appearance.text_size", value: 110 });
  await s.data.call("settings.set", { key: "appearance.reduce_motion", value: true });
  const out = html(s, { initialPage: "appearance" });
  assert.match(tag(out, "ctl-appearance.density-compact"), /aria-checked="true"/);
  assert.ok(has(out, ">110%<"));
  assert.match(tag(out, "ctl-appearance.reduce_motion"), /aria-checked="true"/);
});

test("Appearance: System is the tile that is on until a skin is chosen; the preview follows the chosen skin", async () => {
  const s = createSampleSettings(harbor);
  assert.match(tag(html(s, { initialPage: "appearance" }), "skin-system"), /aria-checked="true"/);
  await s.data.call("settings.set", { key: "appearance.skin", value: "linen" });
  const out = html(s, { initialPage: "appearance" });
  assert.match(tag(out, "skin-linen"), /aria-checked="true"/);
  assert.match(tag(out, "skin-system"), /aria-checked="false"/);
  assert.ok(has(out, 'aria-label="Preview of Linen"') && has(out, "Just for you, in Harbor Studio"));
});

test("Notifications: Notify me on lists each kind with how it arrives, with no explaining sentence under it", () => {
  const out = html(createSampleSettings(northwind), { initialPage: "notifications" });
  assert.ok(has(out, "Notify me on"));
  for (const t of ["Needs you", "Mentions", "Replies in your threads", "Agent finished a long task", "Routines", "Channel messages"]) assert.ok(has(out, t), t);
  assert.ok(has(out, "Interrupt on desktop, Interrupt on phone") && has(out, "Badge only") && has(out, "Digest"));
  for (const gone of ["Interrupt rings and shows a banner", "Waits outside your working hours", "How each kind arrives"]) assert.ok(!has(out, gone), gone);
});

test("Sign-in and devices: Password and GitHub, then one card per Space with its second factor, passkeys, floor, single sign-on and devices", async () => {
  const s = createSampleSettings(northwind);
  const out = html(s, { initialPage: "signin" });
  assert.ok(has(out, 'data-testid="signin-account"') && has(out, "Changed 3 months ago") && has(out, "Connected as @irfad7"));
  for (const sp of ["northwind", "harbor", "personal"]) assert.ok(has(out, `data-testid="security-${sp}"`), sp);
  const nw = out.slice(out.indexOf('data-testid="security-northwind"'), out.indexOf('data-testid="security-harbor"'));
  assert.ok(has(nw, "One-time codes on your phone") && has(nw, "MacBook Touch ID") && has(nw, "Second factor required") && has(nw, "Set by Northwind") && has(nw, "Authenticator app or passkey"));
  assert.ok(has(nw, "Your admin signs you in with Google Workspace") && has(nw, "Signed in on 4 devices") && has(nw, "Open now"));
  const hb = out.slice(out.indexOf('data-testid="security-harbor"'), out.indexOf('data-testid="security-personal"'));
  assert.ok(has(hb, "Not set up") && has(hb, "None yet") && has(hb, "This Space uses its own password") && has(hb, 'data-testid="open-harbor"'));
  const me = out.slice(out.indexOf('data-testid="security-personal"'));
  assert.ok(has(me, "This computer only") && !has(me, "Single sign-on"));
  assert.ok(out.indexOf("signin-account") < out.indexOf("security-northwind") && out.indexOf("security-personal") < out.indexOf("Devices and computers"));
  for (const gone of ["A signed-out device loses its copy", "There is no central account"]) assert.ok(!has(out, gone), gone);
});

test("no page carries an explaining paragraph under its heading", () => {
  const s = createSampleSettings(northwind);
  for (const key of ["profile", "notifications", "models", "connections", "privacy", "signin", "appearance", "keyboard", "computer", "spaces"] as const) {
    const out = html(s, { initialPage: key });
    for (const gone of ["Your hours are", "Provider sign-ins and keys live in the Vault", "Connect a mailbox and calendar so agents", "Your private items stay yours", "Type the keys you want", "Agents work on this computer only as far"]) assert.ok(!has(out, gone), `${key}: ${gone}`);
  }
});
