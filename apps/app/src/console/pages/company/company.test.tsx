// The screen leads: one step open, with what to do now. A key never comes back. The Space owner's two safety conditions show as why the button is off.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../../shell/data.tsx";
import type { ConsoleData } from "../../shell/data.tsx";
import { createSampleConsole } from "../../shell/sample.ts";
import { FLOW_STEPS } from "../../../../../../lib/company-flow.ts";
import { ConnectCompanyPage } from "./ConnectCompany.tsx";
import { connectLine, dataLine, readPasted } from "./flow.ts";

function draw(rows: Record<string, unknown>): string {
  const sample = createSampleConsole().data;
  const data: ConsoleData = { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const state = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => state, getState: () => state, refetch: async () => undefined, invalidate: () => undefined }; } } } as never;
  return renderToStaticMarkup(<ConsoleDataProvider value={data}><ConnectCompanyPage /></ConsoleDataProvider>);
}
const data = { mail: true, calendar: true, files: true };
const status = (provider: "google" | "microsoft", done: string[], next?: string, o: Record<string, unknown> = {}) => ({
  started: true, provider, title: provider === "google" ? "Google Workspace" : "Microsoft 365", data, doc: "x", keyHandle: "#Google_DWD", connected: false, mapped: 3, excluded: [], requireSso: false,
  steps: FLOW_STEPS[provider].map((s) => ({ id: s.id, title: s.title, doc: s.doc, done: done.includes(s.id), ...(s.optional ? { optional: true } : {}) })), ...(next ? { next } : {}), ...o,
});

test("not started: it asks which one, and offers Mail, Calendar and Files on their own", () => {
  const html = draw({ "company.status": { started: false, providers: [] } });
  for (const t of ["Google Workspace", "Microsoft 365", "Mail", "Calendar", "Files", "Start"]) assert.ok(html.includes(t), t);
});

test("the next step is open and the others are only their titles", () => {
  const html = draw({ "company.status": status("google", ["choose"], "access_key"), "company.script": { shell: "Google Cloud Shell", url: "https://console.cloud.google.com/cloudshell", script: "gcloud projects create" }, "vault.folders.list": { folders: [] }, "vault.items.list": { items: [] } });
  assert.ok(html.includes("Open Google Cloud Shell") && html.includes("gcloud projects create") && html.includes("Drop vyre-key.json here"), "what to do now");
  assert.ok(html.includes("Read the guide for this step"));
  assert.ok(html.includes("Allow the scopes in Google Admin"), "a later step keeps its place");
  assert.ok(!html.includes("Open Google Admin"), "and is not open yet");
});

test("allowing the scopes shows the exact client id and scopes, with copy buttons", () => {
  const scopes = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/admin.directory.user.readonly"];
  const html = draw({ "company.status": status("google", ["choose", "access_key"], "access_allow", { clientId: "1234567890" }), "google.dwd.scopes": { scopes, adminConsoleUrl: "x" } });
  assert.ok(html.includes("1234567890"));
  assert.ok(html.includes(scopes.join(",")), "one line to paste");
  assert.ok((html.match(/>Copy</g) ?? []).length >= 2);
  assert.ok(html.includes("up to 24 hours"));
});

test("Microsoft: the Exchange step shows the snippet and says Files has no such limit", () => {
  const html = draw({ "company.status": status("microsoft", ["choose", "access_key", "access_allow"], "access_limit"), "ms.consent.policy_snippet": { language: "powershell", groupName: "VyreMappedMembers", snippet: "New-ManagementScope -Name x" } });
  assert.ok(html.includes("New-ManagementScope"));
  assert.ok(html.includes("Files has no such limit at Microsoft"));
});

test("everyone must use it says why it is off until the owner cannot be locked out", () => {
  const rows = (o: Record<string, unknown>) => ({ "company.status": status("google", ["choose", "access_key", "access_allow", "signin_app", "signin_try"], "access_probe", o), "members.sign_in_policy.get": { policy: { secondFactor: "off", requireSso: false, allowPassword: true, allowGithub: false } } });
  assert.ok(draw(rows({ signInTried: true, recoveryKey: false })).includes("save a recovery key"));
  assert.ok(!draw(rows({ signInTried: true, recoveryKey: true })).includes("save a recovery key"));
});

test("connected: it says so, with Disconnect and the access log", () => {
  const steps = FLOW_STEPS.google.map((s) => s.id);
  const html = draw({ "company.status": status("google", steps, undefined, { connected: true, lastSweep: "Directory checked: 9 people." }), "company.access_log": { entries: [{ who: "agt_assist", onBehalf: "usr_maya", mailbox: "maya@firm.test", cap: "google.gmail.get_profile", at: 1 }] } });
  for (const t of ["Google Workspace is connected", "Directory checked: 9 people.", "Disconnect", "Access log", "maya@firm.test", "agt_assist for usr_maya"]) assert.ok(html.includes(t), t);
});

test("a pasted key is read for what it is before anything is stored", () => {
  const hand = { tenantId: "", clientId: "", clientSecret: "" };
  assert.equal(readPasted("google", "{not json", hand).ok, false);
  assert.match((readPasted("google", JSON.stringify({ type: "authorized_user" }), hand) as { problem: string }).problem, /not a Google service-account key/);
  const line = JSON.stringify({ clientId: "a", tenantId: "t", thumbprint: "ab", private_key: "k", clientSecret: "sso" });
  const ok = readPasted("microsoft", line, hand);
  assert.ok(ok.ok && ok.value.kind === "microsoft" && ok.value.signInSecret === "sso", "the sign-in secret travels with the script's line");
  assert.equal(readPasted("microsoft", "", { tenantId: "t", clientId: "nope", clientSecret: "abcdefghij" }).ok, false);
});

test("the sentences read right", () => {
  assert.equal(dataLine({ mail: true, calendar: false, files: true }), "Mail and Files");
  assert.equal(connectLine(1, 2, data), "1 person gets Mail, Calendar and Files with nothing to sign in to. 2 excluded stay out.");
});
