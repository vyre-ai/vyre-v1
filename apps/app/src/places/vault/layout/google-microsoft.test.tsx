// The Vault's Google and Microsoft page: a person who cannot open Connect your company sees no Connect button, not a button that goes nowhere.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleVault } from "./sample.ts";
import { VaultDataProvider } from "./data.tsx";
import { GoogleMicrosoftPage } from "./SectionPages.tsx";

const page = (onOpenCompany?: () => void) =>
  renderToStaticMarkup(
    <VaultDataProvider value={createSampleVault().data}>
      <GoogleMicrosoftPage keys={null} {...(onOpenCompany ? { onOpenCompany } : {})} />
    </VaultDataProvider>,
  );

test("no way into the company setup: no Connect button on either card", () => {
  const out = page();
  assert.ok(out.includes("vault-gm"));
  assert.ok(!out.includes("Connect Google") && !out.includes("Connect Microsoft"));
});

test("with a way in, each card offers its Connect button", () => {
  const out = page(() => undefined);
  assert.ok(out.includes("Connect Google") && out.includes("Connect Microsoft"));
});
