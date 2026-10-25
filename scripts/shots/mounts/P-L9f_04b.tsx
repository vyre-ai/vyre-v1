// Mount for P-L9f_04b: the Vault Add sheet with the search box focused (the same mount as P-L9f_04, ?sheet=add).
// Mount for P-L9f_04: the Vault place over the Northwind sample Space, or Harbor Studio with ?space=harbor. Every control works against the sample replica.
// ?view=fields opens the card in Fields; ?sheet=add (with ?paste=...) or ?sheet=edit opens a sheet; ?rows=10000 adds ten thousand keys for the scroll probe.
import { useMemo } from "react";
import type { ReactNode } from "react";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault, harbor, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";

export const title = "Vault";

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const rows = Number(q.get("rows") ?? "0") || 0;
  const sample = useMemo(() => createSampleVault(space, { extraItems: rows }), [space, rows]);
  const sheet = q.get("sheet");
  const paste = q.get("paste") ?? undefined;
  const first = space === harbor ? "vit_figma" : "vit_ghl";
  return (
    <Vault
      data={sample.data}
      view={q.get("view") === "fields" ? "fields" : undefined}
      sheet={sheet === "add" ? { add: paste ? { paste } : {} } : sheet === "edit" ? { edit: first } : undefined}
    />
  );
}
