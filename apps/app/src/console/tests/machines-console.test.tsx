// The Console's side of Machines: the page the provider draws, the alerts among what needs you, and the tile that opens the machine.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { consolePageFor } from "../../shell/providers/console.tsx";
import { Overview } from "../pages/overview/Overview.tsx";

const draw = (element: React.ReactElement, rows: Record<string, unknown>): string => {
  const base = createSampleConsole().data;
  const data = { ...base, screens: { ...base.screens, capQuery: (cap: string) => { const value = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => value }; } } as never };
  return renderToStaticMarkup(<ConsoleDataProvider value={data}>{element}</ConsoleDataProvider>).replaceAll("<!-- -->", "");
};

test("the provider draws the shared Machines page for the machines place, and the old computers id is gone", () => {
  const page = consolePageFor("machines", {});
  assert.ok(renderToStaticMarkup(<ConsoleDataProvider value={createSampleConsole().data}>{page}</ConsoleDataProvider>).includes('data-testid="machines"'));
  const old = consolePageFor("computers", {}) as React.ReactElement<{ message?: string }>;
  assert.match(String(old.props.message), /not implemented/, "the old id is a redirect in the shell, not a page");
});

test("a machine alert is a line among what needs you, with a way to the machine, and a tile counts them", () => {
  const out = draw(<Overview />, { "network.machine_alerts": { alerts: [{ alertId: "disk:srv_box", serverId: "srv_box", kind: "disk", title: "Berlin box has 8% disk left", detail: "12 GB of 160 GB free" }, { alertId: "offline:srv_dev_omar", serverId: "srv_dev_omar", kind: "offline", title: "Omar's iMac is offline and Scout is pinned to it", detail: "Last seen 125 minutes ago" }] } });
  assert.ok(out.includes("Berlin box has 8% disk left") && out.includes("Omar&#x27;s iMac is offline"));
  assert.ok(out.includes('data-testid="row-attn-machine-disk:srv_box"') && out.includes('data-testid="attn-machine-go-srv_box"'));
  assert.ok(out.includes('data-testid="tile-Machine alerts"') && /Machine alerts: 2/.test(out));
  const quiet = draw(<Overview />, { "network.machine_alerts": { alerts: [] } });
  assert.ok(quiet.includes("All clear") && !quiet.includes("attn-machine"));
  assert.ok(quiet.includes("Health"), "the section is Health now");
});
