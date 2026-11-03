// Settings > This device: my own machines through the shared Machines component, then what is only about this device. Asked for from the Space menu, the page opens with the Add a server sheet, once.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { ThisDevicePage } from "./ThisDevice.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

test("This device draws my machines first, then Phone access, and the old Computers page is gone", () => {
  const s = createSampleSettings(northwind);
  const out = renderToStaticMarkup(<SettingsDataProvider value={{ ...s.data, call: async () => ({}) }}><ThisDevicePage /></SettingsDataProvider>).replaceAll("<!-- -->", "");
  assert.ok(out.includes('data-testid="machines"'), "the shared Machines component");
  assert.ok(out.includes("Loading machines"), "it reads the machines through network.machines");
  assert.ok(!out.includes("Needs a Team Space"));
});

test("asked for from the Space menu or an agent's page, This device opens with the Add a server sheet, once", async () => {
  const { requestAddServer, addServerAsked, takeAddServerRequest } = await import("../../shell/computers-available.ts");
  const s = createSampleSettings(northwind);
  const draw = (): string => renderToStaticMarkup(<SettingsDataProvider value={{ ...s.data, call: async () => ({}) }}><ThisDevicePage /></SettingsDataProvider>);
  assert.ok(!draw().includes('data-testid="add-server-sheet"'), "nothing asked, no sheet");
  requestAddServer();
  assert.equal(addServerAsked(), true);
  assert.ok(draw().includes('data-testid="add-server-sheet"'), "the sheet is open");
  assert.equal(addServerAsked(), false, "taken: a redraw does not open it again");
  assert.equal(takeAddServerRequest(), false);
});
