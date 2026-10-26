import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleSettings } from "../../places/settings/sample.ts";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import SettingsShellPlace, { settingsData } from "./settings.tsx";

test("the Settings place draws its pages through the shell runtime", () => {
  const s = createSampleSettings();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const out = renderToStaticMarkup(<ShellRuntimeProvider value={rt}><SettingsShellPlace place="settings" /></ShellRuntimeProvider>);
  assert.ok(out.includes("Profile"));
  assert.ok(!out.includes("settings-loading"));
});

test("without a runtime Settings draws its loading frame", () => {
  assert.ok(renderToStaticMarkup(<SettingsShellPlace place="settings" />).includes("settings-loading"));
});

test("Settings leaves for the Vault and the Console through the shell's door", () => {
  const s = createSampleSettings();
  const opened: string[] = [];
  const d = settingsData(sampleRuntime({ screens: s.data.screens, call: s.data.call, opened }));
  d.nav.openVault();
  d.nav.openConsole();
  assert.deepEqual(opened, ["vault.layout", "console.overview"]);
  assert.equal(d.space.name, "Northwind");
});
