import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ConsoleDataProvider } from "../../shell/data.tsx";
import type { ConsoleData } from "../../shell/data.tsx";
import { createSampleConsole } from "../../shell/sample.ts";
import { GoogleWorkspacePage } from "./GoogleWorkspace.tsx";
import { Microsoft365Page } from "./Microsoft365.tsx";

function draw(element: ReactElement, rows: Record<string, unknown>): string {
  const sample = createSampleConsole().data;
  const data: ConsoleData = { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const state = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => state }; } } as never };
  return renderToStaticMarkup(<ConsoleDataProvider value={data}>{element}</ConsoleDataProvider>);
}

const SCOPES = ["gmail.modify", "calendar", "drive", "spreadsheets", "documents", "meetings.space.readonly"].map((s) => `https://www.googleapis.com/auth/${s}`);
const vault = { "vault.folders.list": { folders: [{ id: "fld_1", name: "Company", yourLevel: "manage" }] }, "vault.items.list": { items: [] } };
const gStatus = (o: Record<string, unknown> = {}) => ({ configured: false, autoConnect: true, mappedMembers: 0, excluded: [], ...o });

test("Google, not set up: the page reads healthy with a hint and lists every step with the exact scopes to copy", () => {
  const html = draw(<GoogleWorkspacePage />, { ...vault, "google.dwd.status": gStatus(), "google.dwd.scopes": { scopes: SCOPES, adminConsoleUrl: "https://admin.google.com/ac/owl/domainwidedelegation" } });
  assert.match(html, /Google Workspace is not connected/);
  assert.match(html, /Nothing is wrong/);
  for (const step of ["Create a service account in Google Cloud", "Add the key to the Vault", "Allow the scopes in Google Admin", "Connect", "Check the connection"]) assert.ok(html.includes(step), step);
  for (const s of SCOPES) assert.ok(html.includes(s), s);
  assert.ok(html.includes(SCOPES.join(",")), "one box with every scope");
  assert.ok((html.match(/>Copy</g) ?? []).length >= 7, "a Copy button on the client id row's scopes and the all-scopes box");
  assert.ok(html.includes("https://") === false || !/href="http/.test(html), "links open through the app, not as bare hrefs");
  for (const label of ["Open Service accounts in Google Cloud", "Open Domain-wide delegation in Google Admin", "Open the API library"]) assert.ok(html.includes(label), label);
  assert.equal((html.match(/Not set up yet/g) ?? []).length, 5, "five services, each healthy with a hint");
  assert.ok(!html.includes("Degraded"));
  assert.match(html, /Gmail API/);
});

test("Google, connected with a missing scope: Drive and Docs and Sheets degrade; the others stay healthy", () => {
  const html = draw(<GoogleWorkspacePage />, {
    ...vault,
    "google.dwd.status": gStatus({ configured: true, adminEmail: "admin@firm.com", domain: "firm.com", lastProbeOk: false, lastProbeAt: 1, mappedMembers: 2 }),
    "google.dwd.scopes": { scopes: SCOPES, clientId: "104857384729183746501", adminConsoleUrl: "https://admin.google.com/" },
    "google.dwd.members": { members: [{ email: "maya@firm.com", userId: "usr_1", mapped: true, excluded: false, mailboxState: "connected" }, { email: "sam@firm.com", userId: "usr_2", mapped: true, excluded: true }] },
  });
  assert.match(html, /Google Workspace needs attention/);
  assert.match(html, /The last check failed/);
  assert.ok(html.includes("104857384729183746501"), "the client id to paste");
  assert.ok(html.includes("maya@firm.com") && html.includes("sam@firm.com"));
  assert.match(html, />Include</);
  assert.match(html, />Exclude</);
  assert.match(html, /never reads this person/);
  assert.match(html, /Match an address to a person/);
  assert.match(html, />Unmatch</);
  assert.ok(html.includes("Check connection") && html.includes("Turn off"));
});

test("Google, healthy: every service reads healthy and the members are counted", () => {
  const html = draw(<GoogleWorkspacePage />, {
    ...vault,
    "google.dwd.status": gStatus({ configured: true, adminEmail: "admin@firm.com", lastProbeOk: true, mappedMembers: 1 }),
    "google.dwd.scopes": { scopes: SCOPES, clientId: "1", adminConsoleUrl: "https://admin.google.com/" },
    "google.dwd.members": { members: [{ email: "maya@firm.com", userId: "usr_1", mapped: true, excluded: false }] },
  });
  assert.match(html, /Google Workspace is connected/);
  assert.match(html, /1 member is included/);
  assert.ok(!html.includes("Degraded"));
  for (const name of ["Mail", "Calendar", "Drive", "Meet", "Docs and Sheets"]) assert.ok(html.includes(name), name);
});

test("Google never draws a stored key: only the public identity can appear", () => {
  const html = draw(<GoogleWorkspacePage />, { "vault.folders.list": vault["vault.folders.list"], "vault.items.list": { items: [{ id: "vit_1", handle: "#Google_DWD", name: "Google_DWD" }] }, "google.dwd.status": gStatus(), "google.dwd.scopes": { scopes: SCOPES, adminConsoleUrl: "x" } });
  assert.ok(html.includes("#Google_DWD"));
  assert.ok(!/PRIVATE KEY/.test(html));
  assert.ok(html.includes("Replace key in the Vault"));
});

const PERMS = ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite.All", "User.Read.All", "OnlineMeetingRecording.Read.All", "OnlineMeetingTranscript.Read.All"];
const mStatus = (o: Record<string, unknown> = {}) => ({ configured: false, consentGiven: false, policyConfirmed: false, autoConnect: true, mappedMembers: 0, excluded: [], ...o });

test("Microsoft, not set up: seven steps, the permissions to add, and healthy services with a hint", () => {
  const html = draw(<Microsoft365Page />, { ...vault, "ms.consent.status": mStatus() });
  assert.match(html, /Microsoft 365 is not connected/);
  for (const step of ["Register an app in Microsoft Entra", "Add the application permissions", "Create a client secret and add it to the Vault", "Connect", "Grant admin consent", "Limit the app to the members you include", "Check the connection"]) assert.ok(html.includes(step), step);
  for (const p of PERMS) assert.ok(html.includes(p), p);
  assert.ok(html.includes("Open App registrations in Microsoft Entra"));
  assert.equal((html.match(/Not set up yet/g) ?? []).length, 5);
  assert.ok(html.includes("OneDrive and SharePoint") && html.includes("Teams"));
});

test("Microsoft, connected and consented: the consent link, the access policy script and the members are there", () => {
  const html = draw(<Microsoft365Page />, {
    ...vault,
    "ms.consent.status": mStatus({ configured: true, tenantId: "firm.onmicrosoft.com", consentGiven: true, policyConfirmed: true, lastVerifyAt: 1, mappedMembers: 1 }),
    "ms.consent.link": { url: "https://login.microsoftonline.com/firm.onmicrosoft.com/adminconsent?client_id=abc", permissions: PERMS },
    "ms.consent.policy_snippet": { language: "powershell", snippet: "New-ApplicationAccessPolicy -AppId \"abc\"", groupName: "VyreMappedMembers" },
    "ms.consent.members": { members: [{ email: "maya@firm.com", userId: "usr_1", mapped: true, excluded: false, mailboxState: "pending" }] },
  });
  assert.match(html, /Microsoft 365 is connected/);
  assert.match(html, /Open the admin consent page/);
  assert.match(html, /New-ApplicationAccessPolicy/);
  assert.match(html, /Waiting for them to accept/);
  assert.match(html, /Marked as done/);
});

test("Microsoft, consent not given: the services that need the missing permission are named", () => {
  const html = draw(<Microsoft365Page />, {
    ...vault,
    "ms.consent.status": mStatus({ configured: true, tenantId: "t", consentGiven: false, lastVerifyAt: 1 }),
    "ms.consent.members": { members: [] },
  });
  assert.match(html, /Microsoft 365 needs attention/);
  assert.match(html, /The last check failed/);
});
