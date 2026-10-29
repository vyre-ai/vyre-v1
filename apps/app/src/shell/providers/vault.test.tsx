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
  d.nav.openBackups();
  d.nav.openDevices();
  d.nav.openOutsideActors();
  d.nav.openAgent("agt_intake");
  assert.deepEqual(opened, ["vault.layout", "console.backups", "devices.mine", "console.outside-actors", "chats.agent-page"]);
});

test("Vault hashes route share, export, Advanced, and requests into their real surfaces", () => {
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { share: "vit_ghl" } }), { itemId: "vit_ghl", surface: "share" });
  assert.deepEqual(vaultRoute({ screen: "vault.export", args: { folderId: "fld_marketing" } }), { folderId: "fld_marketing", surface: "export" });
  assert.deepEqual(vaultRoute({ screen: "vault.layout", args: { advanced: "true" } }), { surface: "advanced" });
  assert.deepEqual(vaultRoute({ screen: "vault_requests.list", args: {} }), { surface: "requests" });

  const s = createSampleVault();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const draw = (hash: string): string => renderToStaticMarkup(
    <ShellRuntimeProvider value={rt}><PlaceHashProvider hash={hash} opened={() => undefined}><VaultPlace place="vault" /></PlaceHashProvider></ShellRuntimeProvider>,
  );
  assert.match(draw("screen=vault.layout&share=vit_ghl"), /data-testid="item-env"/);
  const exported = draw("screen=vault.export&folderId=fld_marketing");
  assert.match(exported, /data-testid="vault-export-sheet"/);
  assert.match(exported, /Active exports/);
  assert.match(exported, /data-testid="vault-export-revoke-vex_marketing"/);
  const advanced = draw("screen=vault.layout&advanced=true");
  assert.match(advanced, /data-testid="vault-advanced"/);
  assert.doesNotMatch(advanced, /Emergency access|Recovery key/);
  const requests = draw("screen=vault_requests.list");
  assert.match(requests, /data-testid="vault-requests"/);
  assert.match(requests, /data-testid="vault-request-use-req_twilio-vit_twilio"/);
  assert.match(requests, /data-testid="vault-request-decline-req_twilio"/);
});
