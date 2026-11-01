import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { appName, hubById } from "../../../../lib/mcp-hubs.ts";
import { AppHubsView, groupByApp, hubHeaders } from "./AppHubs.tsx";

const composio = hubById("composio")!;
const tools = [
  { name: "SLACK_LIST_CHANNELS", description: "", readOnly: true },
  { name: "SLACK_SEND_MESSAGE", description: "", readOnly: false },
  { name: "HUBSPOT_CREATE_CONTACT", description: "", readOnly: false },
];
const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const view = (connections: { connectionId: string; name: string; hub: string }[], servers = {}) =>
  text(renderToStaticMarkup(<AppHubsView connections={connections} servers={servers} onConnect={async () => undefined} onDisconnect={() => undefined} />));

test("tools group by app with the app's own name", () => {
  const g = groupByApp(composio, tools);
  assert.deepEqual(g.map((x) => x.label), ["HubSpot", "Slack"]);
  assert.equal(g[1]!.tools.length, 2);
  assert.equal(appName("googlecalendar"), "Google Calendar");
  assert.equal(appName("unknownapp"), "Unknownapp");
});

test("hub headers hold a Vault handle, never a value", () => {
  assert.deepEqual(hubHeaders(composio, "#Composio_key.api_key"), { "x-api-key": "#Composio_key.api_key" });
  assert.equal(hubHeaders(hubById("pipedream")!, "#P.api_key").Authorization, "Bearer #P.api_key");
});

test("with no hub the card offers one line to connect many apps", () => {
  const t = view([]);
  assert.match(t, /Connect many apps at once/);
  assert.doesNotMatch(t, /Runs through/);
});

test("the hub says where it runs once; apps show collapsed with their tool count and no per-tool labels", () => {
  const t = view([{ connectionId: "mcs_1", name: "composio", hub: "composio" }], { composio: { ok: true, tools } });
  assert.equal((t.match(/Runs through Composio/g) ?? []).length, 1);
  assert.match(t, /HubSpot/);
  assert.match(t, /1 tool . Shared by the Space/);
  assert.match(t, /2 tools . Each person signs in/);
  assert.doesNotMatch(t, /Asks first|Reads|Disconnect/);
  assert.match(t, /Connect an app hub/);
});

test("the Replace key sheet finds the Vault item a header points at", async () => {
  const { handleOf } = await import("./ReplaceKey.tsx");
  assert.deepEqual(handleOf("#Composio_key.api_key"), { item: "Composio_key", field: "api_key" });
  assert.deepEqual(handleOf("Bearer #Pipedream_key.api_key"), { item: "Pipedream_key", field: "api_key" });
  assert.equal(handleOf("plain text"), null);
});
