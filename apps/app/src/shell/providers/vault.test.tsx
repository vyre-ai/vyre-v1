import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleVault } from "../../places/vault/layout/sample.ts";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import VaultPlace, { vaultData } from "./vault.tsx";

test("the Vault place draws the Space's items through the shell runtime", () => {
  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const out = renderToStaticMarkup(<ShellRuntimeProvider value={rt}><VaultPlace place="vault" /></ShellRuntimeProvider>);
  assert.ok(out.includes("Stripe"), "an item of the Space shows");
  assert.ok(!out.includes("vault-loading-frame"));
});

test("without a runtime the Vault draws its loading frame", () => {
  assert.ok(renderToStaticMarkup(<VaultPlace place="vault" />).includes("vault-loading"));
});

test("a click that leaves the Vault goes out through the shell's door", () => {
  const s = createSampleVault();
  const opened: string[] = [];
  const d = vaultData(sampleRuntime({ screens: s.data.screens, call: s.data.call, opened }));
  d.nav.openAdvanced();
  d.nav.openAgent("agt_intake");
  assert.deepEqual(opened, ["vault.layout", "chats.agent-page"]);
});
