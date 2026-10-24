// Merge policy and sensitivity of a field, from the generated entity catalog (ARCH 5.4 step 3). A field the catalog lists as protected goes to the assistant; a record type may say more.
import type { Catalog } from "../pull/catalog.ts";
import type { Policy } from "./merge.ts";
import type { PushDeps } from "./types.ts";

export function catalogPolicy(catalog: Catalog, own?: (entity: string, field: string) => Policy | undefined): PushDeps["policy"] {
  return (entity, field) => own?.(entity, field) ?? (catalog.get(entity).protectedFields.includes(field) ? "assistant" : "lww");
}

/** Restricted is rank 3 (labels.ts). */
export function catalogRestricted(catalog: Catalog): PushDeps["restricted"] {
  return (entity, field) => (catalog.get(entity).fieldLabels[field] ?? 0) >= 3;
}
