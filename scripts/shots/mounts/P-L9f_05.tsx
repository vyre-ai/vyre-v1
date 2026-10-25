// Mount for P-L9f_05: the Vault's AI providers, Add a provider, Health and Import over the Northwind sample Space, or Harbor Studio with ?space=harbor. Every control works against the sample replica.
// ?view=providers (default: the AI providers section, the first provider open with its panel), anthropic (the shared API key), add (Add an AI provider, the gallery), addkey (OpenAI, paste a key),
// health (the Health section), import (Import, choosing where the export came from), importfile (Import from Bitwarden, choosing the file).
import { useMemo } from "react";
import type { ReactNode } from "react";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import type { InitialSheet } from "../../../apps/app/src/places/vault/layout/index.tsx";
import type { Selection } from "../../../apps/app/src/places/vault/layout/model.ts";
import { createSampleVault, harbor, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { withProviders } from "../../../apps/app/src/places/vault/providers/sample.ts";

export const title = "Vault providers, health and import";

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const view = q.get("view") ?? "providers";
  const sample = useMemo(() => withProviders(createSampleVault(space)), [space]);
  const initial: Selection = view === "health" ? { kind: "health" } : { kind: "providers" };
  const sheet: InitialSheet | undefined =
    view === "add" ? { addProvider: true }
    : view === "addkey" ? { addProvider: { providerKey: "openai", connection: "api_key" } }
    : view === "import" ? { importFrom: true }
    : view === "importfile" ? { importFrom: "bitwarden" }
    : undefined;
  return <Vault data={sample.data} initial={initial} {...(sheet ? { sheet } : {})} />;
}
