// Console > Apps > Connected apps: one list. Every control is pressed by its testID and the capability it calls is read back from the recorded calls.
import test from "node:test";
import assert from "node:assert/strict";
import { AppsPage, appNote, githubRow, otherSignIns, whatItDoes } from "../pages/AppsList.tsx";
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

test("one list: connected apps show Manage, the others Connect, Google and Microsoft are rows, there is no Kit row, stray sign-ins sit under Other sign-ins", async () => {
  const p = await mountPage(createRoot, <AppsPage />, ROWS);
  try {
    const t = p.text();
    assert.ok(p.has("app-manage-hubspot") && !p.has("app-connect-hubspot"), "connected: Manage only");
    assert.ok(p.has("app-connect-lawmatics") && !p.has("app-manage-lawmatics"), "not connected: Connect only");
    assert.ok(p.has("app-manage-google") && p.has("app-connect-microsoft"), "company sign-ins");
    assert.ok(t.includes("Connect with admin consent") && !t.includes("Open diagnostics") && !p.has("row-app-kit"), "no Kit row: Diagnostics is reached from Computers");
    assert.ok(t.includes("Other sign-ins") && p.has("row-app-other-con_3"), "the sign-in of no app is listed");
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

test("a custom app still being built says it is a draft and not connected yet; a live one, or one with sign-ins, says what it does", () => {
  const base = { mode: "api", syncedTypes: [] as string[] };
  assert.equal(appNote({ ...base, state: "draft", connections: 0 } as never), "Draft. Not connected yet.");
  assert.equal(appNote({ ...base, state: "live", connections: 0 } as never), "Connects with an API key");
  assert.equal(appNote({ ...base, state: "draft", connections: 2 } as never), "Connects with an API key");
});

test("the registry's Google and Microsoft connectors do not draw a second row: one of each, the registry's sign-ins and actions stay on the kept row, and a custom draft still shows", async () => {
  const withRegistry = { ...ROWS,
    "connectors.list": { connectors: [...ROWS["connectors.list"].connectors, connector("google", "Google Workspace", 2, { mode: "dwd" }), connector("microsoft", "Microsoft 365", 0, { mode: "oauth_app" }), connector("fixture_draft", "Fixture draft app", 0, { builtin: false, state: "draft" })] },
    "connections.list": { connections: [...ROWS["connections.list"].connections, connection("con_g1", "google", "Ada's Google", "usr_ada"), connection("con_g2", "google", "Bo's Google", "usr_bo")] } };
  const p = await mountPage(createRoot, <AppsPage />, withRegistry);
  try {
    const t = p.text();
    assert.equal(t.split("Google Workspace").length - 1, 1, "one Google Workspace row");
    assert.equal(t.split("Microsoft 365").length - 1, 1, "one Microsoft 365 row");
    assert.ok(!p.has("app-manage-microsoft") && p.has("app-connect-microsoft") && p.has("app-accounts-google") && p.has("app-accounts-microsoft"), "Manage or Connect for the setup page, Accounts for the registry connector");
    assert.ok(t.includes("Draft. Not connected yet.") && p.has("app-settings-fixture_draft"), "the draft app still shows");
    assert.ok(!t.includes("Kit"));
    await p.press("app-accounts-google");
    assert.ok(p.has("console-app-detail") && p.text().includes("People signed in") && p.has("app-add-signin") && p.has("app-disconnect"), "the registry connector's sign-ins, Add a sign-in and Disconnect are still reachable");
  } finally { p.restore(); }
});

const GH_ROWS = (sign: Record<string, unknown>, app: Record<string, unknown>) => ({ ...ROWS,
  "connectors.list": { connectors: [connector("github", "GitHub", 0), connector("github_signin", "GitHub sign-in", 0, { mode: "oauth_app", scope: "person" }), connector("hubspot", "HubSpot", 2), connector("fixture_draft", "Fixture draft app", 0, { builtin: false, state: "draft" }), connector("dropbox", "Dropbox", 0)] },
  "members.sign_in_github.get": { github: { secretSet: false, callbackUrl: "x", createUrl: "y", ...sign } },
  "ci.settings.get": { githubApp: { ready: false, installed: false, ...app } } });

test("one GitHub row, not two: its note says which app is in use, a Space's own app or the Vyre one", () => {
  assert.deepEqual(githubRow({ source: "env", secretSet: false }, { ready: true, installed: false }), { note: "Uses the Vyre GitHub app", set: false, needsYou: false });
  assert.deepEqual(githubRow({ source: "space", secretSet: true, clientId: "Iv1.abc" }, { ready: true, installed: false }), { note: "Uses your own GitHub app", set: true, needsYou: false });
  assert.equal(githubRow({ source: "space", secretSet: false, clientId: "Iv1.abc" }, undefined).set, false, "an own app without its secret is not set up");
  assert.deepEqual(githubRow({ source: "env", secretSet: false }, { ready: true, installed: true }), { note: "Uses the Vyre GitHub app", set: true, needsYou: false });
  assert.deepEqual(githubRow({ source: "env", secretSet: false }, { ready: false, installed: true }), { note: "Uses the Vyre GitHub app", set: true, needsYou: true });
});

test("the list has one GitHub row that opens the GitHub tab (Set up, or Manage once an app is set up), and none of the registry's two", async () => {
  const p = await mountPage(createRoot, <AppsPage />, GH_ROWS({ source: "env" }, { installed: false }));
  try {
    const t = p.text();
    assert.ok(p.has("row-app-github") && !p.has("row-app-github_signin"), "one GitHub row");
    assert.ok(!t.includes("GitHub sign-in") && t.includes("Uses the Vyre GitHub app") && t.includes("Set up") && !p.has("app-connect-github"));
    await p.press("app-github-open");
    assert.deepEqual(p.opened.at(-1), { page: "ghapp", args: undefined });
  } finally { p.restore(); }
  const q = await mountPage(createRoot, <AppsPage />, GH_ROWS({ source: "space", clientId: "Iv1.abc", secretSet: true }, { installed: true, ready: false }));
  try {
    assert.ok(q.text().includes("Uses your own GitHub app") && q.text().includes("Needs you to accept new permissions") && q.text().includes("Manage"), "own app, needs permissions, Manage");
  } finally { q.restore(); }
});

test("the list is grouped: company sign-ins first, then GitHub, then the other apps A to Z, then the drafts", async () => {
  const p = await mountPage(createRoot, <AppsPage />, GH_ROWS({ source: "env" }, { installed: false }));
  try {
    const t = p.text(), at = (x: string): number => t.indexOf(x);
    const order = ["Google Workspace", "Microsoft 365", "GitHub", "Dropbox", "HubSpot", "Fixture draft app"].map(at);
    assert.ok(order.every((n) => n >= 0) && order.every((n, i) => i === 0 || n > order[i - 1]!), `order: ${JSON.stringify(order)}`);
  } finally { p.restore(); }
});
