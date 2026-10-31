import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { hubById } from "../../../../../lib/mcp-hubs.ts";
import { AppHubsSection, groupByApp, hubHeaders } from "./AppHubs.tsx";

const draw = (el: ReactElement): string => renderToStaticMarkup(<ConsoleDataProvider value={createSampleConsole().data as ConsoleData}>{el}</ConsoleDataProvider>);
const composio = hubById("composio")!;

test("tools group by app and read-only is kept", () => {
  const g = groupByApp(composio, [
    { name: "SLACK_SEND_MESSAGE", description: "", readOnly: false },
    { name: "NOTION_FETCH_PAGE", description: "", readOnly: true },
    { name: "SLACK_LIST_CHANNELS", description: "", readOnly: true },
  ]);
  assert.deepEqual(g.map((x) => x.app), [g[0]!.app, g[1]!.app].sort());
  const slack = g.find((x) => x.tools.length === 2)!;
  assert.equal(slack.tools.some((t) => !t.readOnly), true);
});

test("hub headers hold a Vault handle, never a value", () => {
  assert.deepEqual(hubHeaders(composio, "#Composio_key.api_key"), { "x-api-key": "#Composio_key.api_key" });
  assert.equal(hubHeaders(hubById("pipedream")!, "#P.api_key").Authorization, "Bearer #P.api_key");
});

test("the card says what it is and names the hub on a connected row", () => {
  const empty = draw(<AppHubsSection connections={[]} agentId={undefined} refresh={() => undefined} />).replace(/<[^>]*>/g, " ");
  assert.match(empty, /Connect an app hub/);
  const conn = { connectionId: "mcs_x", name: "composio", scope: "space", url: "https://x.invalid/mcp", args: [], hub: "composio", createdAt: 1 };
  const text = draw(<AppHubsSection connections={[conn as never]} agentId="agt_x" refresh={() => undefined} />).replace(/<[^>]*>/g, " ");
  assert.match(text, /Runs through Composio/);
});
