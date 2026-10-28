import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleVault } from "../../places/vault/layout/sample.ts";
import { PlaceHashProvider } from "../hash/context.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import VaultPlace, { vaultData, vaultRoute } from "./vault.tsx";

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

test("Vault hashes route share, export, Advanced, and requests into their real surfaces", () => {
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { share: "vit_ghl" } }), { itemId: "vit_ghl", surface: "share" });
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { export: "fld_marketing" } }), { folderId: "fld_marketing", surface: "export" });
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { advanced: "true" } }), { surface: "advanced" });
  assert.deepEqual(vaultRoute({ screen: "vault_requests.list", args: {} }), { surface: "requests" });

  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const draw = (hash: string): string => renderToStaticMarkup(
    <ShellRuntimeProvider value={rt}><PlaceHashProvider hash={hash} opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>,
  );
  assert.match(draw("screen=vault.layout&share=vit_ghl"), /data-testid="item-env"/);
  assert.match(draw("screen=vault.layout&export=fld_marketing"), /data-testid="vault-export-sheet"/);
  assert.match(draw("screen=vault.layout&advanced=true"), /data-testid="vault-advanced"/);
  assert.match(draw("screen=vault_requests.list"), /data-testid="vault-requests"/);
});
