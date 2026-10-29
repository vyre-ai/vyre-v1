import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { PlaceHashProvider } from "../hash/context.tsx";
import VaultPlace, { desktopBrowsers } from "./vault.tsx";
import { ChromeSheet, ChromeSheetBody, chromeSteps } from "../../places/vault/layout/ChromeSheet.tsx";
import { createSampleVault } from "../../places/vault/layout/sample.ts";
import { sampleRuntime } from "./misc-test-runtime.tsx";

test("the desktop shell gives the Vault three fixed commands for Vyre for Chrome and a browser gives none", async () => {
  assert.equal(desktopBrowsers(undefined), undefined, "the web app has no install row");
  const calls: Array<[string, unknown]> = [];
  const b = desktopBrowsers(async (command, args) => { calls.push([command, args]); return command === "install_chrome_extension" ? { extensionDir: "/Users/pat/Library/Application Support/ai.vyre.desktop/chrome-extension", extensionId: "x", version: "1.0.0-rc.3", browsers: ["Google Chrome"] } : undefined; })!;
  const done = await b.install();
  await b.openExtensionsPage();
  await b.revealFolder();
  assert.deepEqual(calls.map((c) => c[0]), ["install_chrome_extension", "open_chrome_extensions", "reveal_chrome_extension"]);
  assert.ok(calls.every((c) => c[1] === undefined), "the page passes the shell nothing: no path, no program");
  assert.deepEqual(done, { extensionDir: "/Users/pat/Library/Application Support/ai.vyre.desktop/chrome-extension", version: "1.0.0-rc.3", browsers: ["Google Chrome"] });
  await assert.rejects(() => desktopBrowsers(async () => ({}))!.install(), /could not tell where/);
  await assert.rejects(() => desktopBrowsers(async () => { throw "Vyre did not find Chrome on this computer."; })!.install(), /did not find Chrome/);
});

test("Advanced lists Browsers only when the desktop shell is there, and the sheet says the three clicks with the folder to pick", () => {
  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const draw = (): string => renderToStaticMarkup(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash="screen=vault.layout&advanced=true" opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>);
  const g = globalThis as { __TAURI__?: unknown };
  assert.doesNotMatch(draw(), /vault-advanced-browsers/);
  g.__TAURI__ = { core: { invoke: async () => undefined } };
  try { assert.match(draw(), /data-testid="row-vault-advanced-browsers"/); } finally { delete g.__TAURI__; }

  const folder = "/Users/pat/chrome-extension";
  const steps = chromeSteps(folder);
  assert.equal(steps.length, 3);
  assert.match(steps[0]!, /Developer mode/);
  assert.match(steps[1]!, /Load unpacked/);
  assert.ok(steps[1]!.includes(folder));
  const idle = renderToStaticMarkup(<ChromeSheetBody done={null} busy={false} failure="" onOpen={() => undefined} onReveal={() => undefined} />);
  assert.doesNotMatch(idle, /vault-chrome-steps/);
  const done = renderToStaticMarkup(<ChromeSheetBody done={{ extensionDir: folder, version: "1.0.0-rc.3", browsers: ["Google Chrome", "Brave"] }} busy={false} failure="" onOpen={() => undefined} onReveal={() => undefined} />);
  assert.match(done, /Installed 1\.0\.0-rc\.3 for Google Chrome, Brave/);
  assert.match(done, /data-testid="vault-chrome-open"/);
  assert.ok(done.includes(folder));
  assert.match(renderToStaticMarkup(<ChromeSheetBody done={null} busy={false} failure="Vyre did not find Chrome on this computer." onOpen={() => undefined} onReveal={() => undefined} />), /role="alert"/);
  const sheet = renderToStaticMarkup(<ChromeSheet browsers={{ install: async () => ({ extensionDir: folder, version: "", browsers: [] }), openExtensionsPage: async () => undefined, revealFolder: async () => undefined }} onClose={() => undefined} />);
  assert.match(sheet, /data-testid="vault-chrome-install"/);
});
