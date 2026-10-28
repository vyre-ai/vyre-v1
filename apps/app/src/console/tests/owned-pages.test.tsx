import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";

function data(rows: Record<string, unknown>): ConsoleData {
  const sample = createSampleConsole().data;
  return { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const value = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => value }; } } as never };
}

const draw = (element: React.ReactElement, rows: Record<string, unknown>): string => renderToStaticMarkup(<ConsoleDataProvider value={data(rows)}>{element}</ConsoleDataProvider>);

test("Agents and actors pages expose their live registers and object actions", async () => {
  const pages = await import("../pages/Agents.tsx").catch(() => null);
  assert.ok(pages, "the Agents and actors Console surfaces exist");
  if (!pages) return;
  const agent = { agentId: "agt_intake", name: "Intake", face: "I", status: "awake", ownerId: "usr_irfad", folderId: "fld_one", accountPolicy: "asker", toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "propose", hasComputer: true, templateVersion: 1, createdAt: 1 };
  assert.match(draw(<pages.AgentsRegister />, { "agents.list": { agents: [agent] } }), /Search|Intake|Pause agent/);
  const agentObject = draw(<pages.AgentsRegister initialAgentId="agt_intake" />, { "agents.list": { agents: [agent] }, "access.principals.effective": { permissions: [], roles: [], grants: [] }, "audit.list": { rows: [] } });
  assert.match(agentObject, /object-header|Overview|Access|Activity|Edit agent|Delete agent|Irfad Imtiaz/);
  assert.doesNotMatch(agentObject, /usr_irfad/);
  const actor = { id: "act_one", name: "Claude Code", owner: "usr_irfad", provider: "anthropic", roles: ["rol_delivery"], status: "active", engineerMcp: false };
  const actorsList = draw(<pages.OutsideActors />, { "access.actors.list": { actors: [actor] } });
  assert.match(actorsList, /Search|Claude Code|Active/);
  const actorObject = draw(<pages.OutsideActors initialActorId="act_one" />, { "access.actors.list": { actors: [actor] }, "audit.list": { rows: [] }, "access.roles.list": { roles: [{ id: "rol_delivery", name: "Delivery role" }] } });
  assert.match(actorObject, /object-header|Overview|Access|Activity|Edit actor|Revoke|Irfad Imtiaz/);
  assert.doesNotMatch(actorObject, /usr_irfad|Role ids \(comma separated\)/);
  const computer = { computerId: "cmt_one", agentId: "agt_intake", state: "asleep", tabs: 0, tabLimit: 8, host: "server", recording: false };
  assert.match(draw(<pages.AgentComputers />, { "computers.list": { computers: [computer] } }), /Search|cmt_one|asleep|Provision computer/);
  const computerObject = draw(<pages.AgentComputers initialComputerId="cmt_one" />, { "computers.list": { computers: [computer] }, "audit.list": { rows: [] } });
  assert.match(computerObject, /object-header|Overview|Access|Activity|Configuration|Remove computer|Intake/);
  assert.doesNotMatch(computerObject, /agt_intake/);
  assert.match(draw(<pages.AgentTemplate />, { "agents.template.get": { version: 2, files: ["AGENT.md"], mode: "suggest", agents: 1 }, "agents.suggestions.list": { suggestions: [] } }), /Version 2|Preview for all agents|AGENT.md/);
});

test("Outside-actor Activity requests changes to the actor, not actions by it", async () => {
  const { actorActivityQuery } = await import("../pages/Agents.tsx");
  assert.deepEqual(actorActivityQuery("act_one"), { target: { kind: "actor", id: "act_one" }, limit: 50 });
});

test("Schema and sensitivity pages expose record-type objects and live label controls", async () => {
  const pages = await import("../pages/Data.tsx").catch(() => null);
  assert.ok(pages, "the owned Data Console surfaces exist");
  if (!pages) return;
  const type = { key: "matter", title: "Matter", plural: "Matters", icon: "record", label: "confidential", system: false, titleField: "title", fields: [{ key: "title", type: "text", title: "Title", required: true }], version: 3 };
  const schema = draw(<pages.SchemaPage />, { "schema.describe": { types: [type] }, "schema.changes.list": { changes: [] }, "schema.trash.list": { items: [] }, "schema.field_types": { fieldTypes: [{ key: "text", title: "Text", filterOps: [], sortable: true, groupable: true, sealed: false }] } });
  assert.match(schema, /Matter|Version 3|Add field|Create record type|Preview schema change/);
  assert.doesNotMatch(schema, /Operations \(JSON array\)/);
  const labels = { labels: [{ label: "public", rank: 0, providers: "any", syncToLaptop: true }, { label: "restricted", rank: 3, providers: "none", syncToLaptop: false }] };
  assert.match(draw(<pages.LabelsPage />, { "access.labels.list": labels }), /Public|Restricted|Set label|Scan record type/);
});

test("Schema apply input preserves the exact preview and creates a fresh attempt key", async () => {
  const { exactSchemaApplyInput } = await import("../pages/Data.tsx");
  const ops = [{ op: "type.drop", type: "matter" }] as const;
  const preview = { previewToken: "preview-1", additive: 0, destructive: 1, problems: [], items: [{ itemKey: "type:matter", summary: "Drop Matter", destructive: true, affectedRows: 4 }] };
  const input = exactSchemaApplyInput(preview, ops);
  assert.deepEqual(input.ops, ops);
  assert.deepEqual(input.confirm, ["type:matter"]);
  assert.equal(input.previewToken, "preview-1");
  assert.match(input.idempotencyKey, /^[0-9a-f-]{36}$/);
});

test("Comms pages use live domains, numbers, inboxes and texting registration contracts", async () => {
  const pages = await import("../pages/Comms.tsx").catch(() => null);
  assert.ok(pages, "the Comms Console surfaces exist");
  if (!pages) return;
  const domain = { id: "dom_one", name: "mail.example.com", provider: "resend", spf: "pass", dkim: "pass", dmarc: "pending", verified: true, isDefault: false };
  assert.match(draw(<pages.DomainsPage />, { "mail.domain.list": { domains: [domain] } }), /mail.example.com|Check DNS|Make default/);
  const number = { id: "num_one", e164: "+15551234567", title: "Support", capabilities: ["voice", "sms"], assigneeKind: "inbox", route: { ring: [], ringSeconds: 20, voicemail: true, voicemailTranscript: true }, hours: { zone: "UTC", weekly: [], outsideHours: "voicemail" }, recording: "off", a2p: "approved", state: "active" };
  assert.match(draw(<pages.NumbersPage />, { "telephony.number.list": { numbers: [number] } }), /Support|Recording|Release/);
  const mailbox = { id: "mbx_one", kind: "shared", address: "support@example.com", title: "Support", provider: "google", privacy: "space", state: "syncing" };
  assert.match(draw(<pages.InboxesPage />, { "mail.mailbox.list": { mailboxes: [mailbox] }, "mail.route.list": { routes: [] } }), /support@example.com|Privacy|New shared inbox/);
  assert.match(draw(<pages.TextingPage />, { "telephony.registration.get": { registration: { id: "reg_one", legalName: "Example LLC", state: "draft" } } }), /Example LLC|Save draft|Submit registration/);
});

test("Integrations pages expose connector, connection, webhook and one-time API key controls", async () => {
  const pages = await import("../pages/Integrations.tsx").catch(() => null);
  assert.ok(pages, "the Integrations Console surfaces exist");
  if (!pages) return;
  const connector = { key: "slack", title: "Slack", mode: "oauth_app", scope: "space", builtin: true, version: "1.0.0", state: "live", domains: ["slack.com"], secrets: [], connections: 1, syncedTypes: ["message"], actions: ["post"], sources: [] };
  assert.match(draw(<pages.IntegrationsPage mode="connectors" />, { "connectors.list": { connectors: [connector] }, "connections.list": { connections: [] } }), /Slack|oauth_app|1 connection/);
  const connection = { connectionId: "con_one", connector: "slack", title: "Team Slack", owner: { kind: "space", id: "space" }, state: "active", scopes: ["chat:write"], createdAt: 1 };
  assert.match(draw(<pages.IntegrationsPage mode="connections" />, { "connections.list": { connections: [connection] }, "connectors.list": { connectors: [connector] } }), /Team Slack|Pause|Test connection/);
  const webhook = { id: "whk_one", name: "Record updates", url: "https://hooks.example.com/vyre", eventTypes: ["record.*"], active: true, secretHint: "1234", createdBy: "usr_owner", createdAt: 1, failureStreak: 0 };
  assert.match(draw(<pages.WebhooksPage />, { "webhooks.list": { webhooks: [webhook] } }), /Record updates|Rotate secret|Disable/);
  const session = { sessionId: "ses_one", kind: "outside", principal: "act_one", name: "Codex", startedAt: 1, calls: 4 };
  assert.match(draw(<pages.ApiKeysPage />, { "mcp.sessions.list": { sessions: [session] } }), /Codex|Issue one-time key|Close session/);
});

test("Console provider dispatches every owned page to a real surface", async () => {
  const provider = await import("../../shell/providers/console.tsx");
  const owned = ["agents", "actors", "computers", "template", "schema", "labels", "domains", "numbers", "inboxes", "texting", "connectors", "connections", "webhooks", "keys"];
  for (const id of owned) {
    const page = provider.consolePageFor?.(id, {});
    assert.ok(page, `${id} has a page component`);
    assert.notEqual((page as React.ReactElement<{ message?: string }>).props.message, `${id} is not implemented in this candidate yet.`);
  }
});
