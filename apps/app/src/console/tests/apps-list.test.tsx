// Console > Apps > Connected apps: one list. Every control is pressed by its testID and the capability it calls is read back from the recorded calls.
import test from "node:test";
import assert from "node:assert/strict";
import { AppsPage, otherSignIns, whatItDoes } from "../pages/AppsList.tsx";
import { createRoot } from "test-renderer";
import { mountPage } from "./page-kit.tsx";

const connector = (key: string, title: string, connections: number, over: Record<string, unknown> = {}) => ({ key, title, mode: "api", scope: "space", builtin: true, version: "1.0.0", state: "live", domains: [], secrets: [], connections, syncedTypes: [], actions: [], sources: [], ...over });
const connection = (id: string, conn: string, title: string, owner = "usr_ada") => ({ connectionId: id, connector: conn, title, owner: { kind: "person", id: owner }, state: "active", scopes: [], createdAt: 1, handles: [], filled: [] });
const ROWS = {
  "connectors.list": { connectors: [connector("hubspot", "HubSpot", 2, { syncedTypes: ["Contacts", "Deals"] }), connector("lawmatics", "Lawmatics", 0)] },
  "connections.list": { connections: [connection("con_1", "hubspot", "HubSpot sales", "usr_ada"), connection("con_2", "hubspot", "HubSpot support", "usr_bo"), connection("con_3", "gone", "Old sign-in", "usr_ada")] },
  "google.dwd.status": { configured: true, domain: "northwind.example", autoConnect: true, mappedMembers: 3, excluded: [], data: { mail: true, calendar: true, files: true }, keyStored: true },
  "ms.consent.status": { configured: false, consentGiven: false, policyConfirmed: false, autoConnect: false, mappedMembers: 0, excluded: [], data: { mail: false, calendar: false, files: false }, appStored: false, permissions: [], exchangeRoles: [] },
};

test("what an app does is in plain words and sign-ins with no app are the other ones", () => {
  assert.equal(whatItDoes({ mode: "api", syncedTypes: ["Contacts", "Deals"] }), "Syncs Contacts, Deals");
  assert.equal(whatItDoes({ mode: "mcp", syncedTypes: [] }), "Connects with an MCP server");
  assert.deepEqual(otherSignIns([{ connector: "a" }, { connector: "z" }], [{ key: "a" }]), [{ connector: "z" }]);
});

test("one list: connected apps show Manage, the others Connect, Google and Microsoft are rows, the Kit row opens diagnostics, stray sign-ins sit under Other sign-ins", async () => {
  const p = await mountPage(createRoot, <AppsPage />, ROWS);
  try {
    const t = p.text();
    assert.ok(p.has("app-manage-hubspot") && !p.has("app-connect-hubspot"), "connected: Manage only");
    assert.ok(p.has("app-connect-lawmatics") && !p.has("app-manage-lawmatics"), "not connected: Connect only");
    assert.ok(p.has("app-manage-google") && p.has("app-connect-microsoft"), "company sign-ins");
    assert.ok(t.includes("Connect with admin consent") && t.includes("Open diagnostics"));
    assert.ok(t.includes("Other sign-ins") && p.has("row-app-other-con_3"), "the sign-in of no app is listed");
    await p.press("app-kit-diagnostics");
    assert.deepEqual(p.opened.at(-1), { page: "diagnostics", args: undefined });
  } finally { p.restore(); }
});

test("Manage on Google Workspace and Connect on Microsoft 365 open their setup pages", async () => {
  const p = await mountPage(createRoot, <AppsPage />, ROWS);
  try {
    await p.press("app-manage-google");
    await p.press("app-connect-microsoft");
    assert.deepEqual(p.opened.map((o) => o.page), ["google", "microsoft"]);
  } finally { p.restore(); }
});

test("Manage lists the people who signed in, and Disconnect asks first, then ends every sign-in of the app", async () => {
  const p = await mountPage(createRoot, <AppsPage />, ROWS);
  try {
    await p.press("app-manage-hubspot");
    const t = p.text();
    assert.ok(t.includes("People signed in") && p.has("row-app-signin-con_1") && p.has("row-app-signin-con_2") && !p.has("row-app-signin-con_3"));
    await p.press("app-disconnect");
    assert.equal(p.called("connections.delete").length, 0, "nothing ends before the confirmation");
    assert.match(p.text(), /Disconnect\s+HubSpot\s*\?/);
    await p.press("app-disconnect-confirm");
    assert.deepEqual(p.called("connections.delete").map((c) => c.input), [{ connectionId: "con_1" }, { connectionId: "con_2" }]);
  } finally { p.restore(); }
});

test("Connect starts the sign-in for that app, with the app already chosen", async () => {
  const p = await mountPage(createRoot, <AppsPage />, { ...ROWS, "connectors.get": { connector: connector("lawmatics", "Lawmatics", 0, { secrets: [{ name: "Token", description: "API key" }] }) }, "vault.items.list": { items: [] } });
  try {
    await p.press("app-connect-lawmatics");
    assert.ok(p.has("connection-create-object"), "the sign-in form is open");
    assert.ok(p.text().includes("Lawmatics"), "the chosen app is the connector");
  } finally { p.restore(); }
});

test("Add a custom app opens the connector builder", async () => {
  const p = await mountPage(createRoot, <AppsPage />, ROWS);
  try {
    await p.press("apps-new");
    assert.ok(p.has("connector-create-object"));
  } finally { p.restore(); }
});

test("no label on the page uses the words the Console dropped", async () => {
  const p = await mountPage(createRoot, <AppsPage />, ROWS);
  try {
    assert.doesNotMatch(p.text(), /\b(connector|principal|grant|scope|tenant)s?\b/i);
    assert.doesNotMatch(p.text(), /!/);
  } finally { p.restore(); }
});
