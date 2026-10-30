// Mount for the Google Workspace and Microsoft 365 setup pages (Console > Integrations): the real pages over scripted capability answers, one scenario per ?part=.
//   google-new, google-bad (a scope missing), google-ok, ms-new, ms-bad (consent not given), ms-ok
import { View } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { GoogleWorkspacePage } from "../../../apps/app/src/console/pages/suite/GoogleWorkspace.tsx";
import { Microsoft365Page } from "../../../apps/app/src/console/pages/suite/Microsoft365.tsx";

export const title = "Google Workspace and Microsoft 365 setup";

const SCOPES = ["gmail.modify", "calendar", "drive", "spreadsheets", "documents", "meetings.space.readonly"].map((s) => `https://www.googleapis.com/auth/${s}`);
const PERMS = ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite.All", "User.Read.All", "OnlineMeetingRecording.Read.All", "OnlineMeetingTranscript.Read.All"];
const vault = { "vault.folders.list": { folders: [{ id: "fld_company", name: "Company connections", yourLevel: "manage" }] } };
const people = [
  { email: "maya.rivera@northwind.example", userId: "usr_maya", mapped: true, excluded: false, mailboxState: "connected" },
  { email: "omar.haddad@northwind.example", userId: "usr_omar", mapped: true, excluded: false, mailboxState: "pending" },
  { email: "lena.berg@northwind.example", userId: "usr_lena", mapped: true, excluded: true },
  { email: "priya.raman@northwind.example", userId: "usr_priya", mapped: true, excluded: false, mailboxState: "connected" },
];
const googleScopes = { scopes: SCOPES, clientId: "104857384729183746501", adminConsoleUrl: "https://admin.google.com/ac/owl/domainwidedelegation" };
const g = (o: Record<string, unknown>) => ({ configured: false, autoConnect: true, mappedMembers: 0, excluded: [], ...o });
const m = (o: Record<string, unknown>) => ({ configured: false, consentGiven: false, policyConfirmed: false, autoConnect: true, mappedMembers: 0, excluded: [], ...o });

const SCENARIOS: Record<string, { page: "google" | "ms"; rows: Record<string, unknown> }> = {
  "google-new": { page: "google", rows: { ...vault, "vault.items.list": { items: [] }, "google.dwd.status": g({}), "google.dwd.scopes": { scopes: SCOPES, adminConsoleUrl: googleScopes.adminConsoleUrl } } },
  "google-bad": {
    page: "google",
    rows: { ...vault, "vault.items.list": { items: [{ id: "vit_g", handle: "#Google_DWD", name: "Google_DWD" }] }, "google.dwd.status": g({ configured: true, adminEmail: "admin@northwind.example", lastProbeOk: false, mappedMembers: 3 }), "google.dwd.scopes": googleScopes, "google.dwd.members": { members: people } },
  },
  "google-ok": {
    page: "google",
    rows: { ...vault, "vault.items.list": { items: [{ id: "vit_g", handle: "#Google_DWD", name: "Google_DWD" }] }, "google.dwd.status": g({ configured: true, adminEmail: "admin@northwind.example", lastProbeOk: true, mappedMembers: 3 }), "google.dwd.scopes": googleScopes, "google.dwd.members": { members: people } },
  },
  "ms-new": { page: "ms", rows: { ...vault, "vault.items.list": { items: [] }, "ms.consent.status": m({}) } },
  "ms-bad": {
    page: "ms",
    rows: {
      ...vault, "vault.items.list": { items: [{ id: "vit_m", handle: "#Microsoft_App", name: "Microsoft_App" }] }, "ms.consent.status": m({ configured: true, tenantId: "northwind.onmicrosoft.com", lastVerifyAt: 1, mappedMembers: 3 }),
      "ms.consent.link": { url: "https://login.microsoftonline.com/northwind.onmicrosoft.com/adminconsent?client_id=11111111-2222-3333-4444-555555555555", permissions: PERMS },
      "ms.consent.policy_snippet": { language: "powershell", snippet: "New-DistributionGroup -Name \"VyreMappedMembers\" -Members \"maya.rivera@northwind.example\"\nNew-ApplicationAccessPolicy -AppId \"11111111-2222-3333-4444-555555555555\" -AccessRight RestrictAccess", groupName: "VyreMappedMembers" },
      "ms.consent.members": { members: people },
    },
  },
  "ms-ok": {
    page: "ms",
    rows: {
      ...vault, "vault.items.list": { items: [{ id: "vit_m", handle: "#Microsoft_App", name: "Microsoft_App" }] }, "ms.consent.status": m({ configured: true, tenantId: "northwind.onmicrosoft.com", consentGiven: true, policyConfirmed: true, lastVerifyAt: 1, mappedMembers: 3 }),
      "ms.consent.link": { url: "https://login.microsoftonline.com/northwind.onmicrosoft.com/adminconsent?client_id=11111111-2222-3333-4444-555555555555", permissions: PERMS },
      "ms.consent.policy_snippet": { language: "powershell", snippet: "New-ApplicationAccessPolicy -AppId \"11111111-2222-3333-4444-555555555555\" -AccessRight RestrictAccess", groupName: "VyreMappedMembers" },
      "ms.consent.members": { members: people },
    },
  },
};

function part(): string {
  const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
  const p = new URLSearchParams(search).get("part") ?? "google-new";
  return p in SCENARIOS ? p : "google-new";
}

export default function Mount() {
  const scenario = SCENARIOS[part()]!;
  const base = createSampleConsole().data;
  const data: ConsoleData = {
    ...base,
    call: async () => ({}),
    screens: { ...base.screens, capQuery: (cap: string) => { const state = { status: "ready", data: scenario.rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => state }; } } as never,
  };
  return (
    <ConsoleDataProvider value={data}>
      <View style={{ flex: 1, padding: 24, maxWidth: 860, width: "100%", alignSelf: "center" }}>{scenario.page === "google" ? <GoogleWorkspacePage /> : <Microsoft365Page />}</View>
    </ConsoleDataProvider>
  );
}
