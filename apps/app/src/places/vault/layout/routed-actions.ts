import type { VaultData } from "./data.tsx";

export type RequestFulfilment =
  | { itemId: string }
  | { fields: { key: string; value: string }[]; folderId?: string | undefined };

/** Credential bytes are opaque. Whitespace is significant and must survive the UI boundary unchanged. */
export function requestFields(keys: readonly string[], draft: Readonly<Record<string, string>>): { key: string; value: string }[] {
  return keys.map((key) => ({ key, value: draft[key] ?? "" }));
}

export async function fulfilVaultRequest(data: VaultData, requestId: string, fulfilment: RequestFulfilment): Promise<void> {
  await data.call("vault.requests.fulfil", { requestId, ...fulfilment });
}

export async function declineVaultRequest(data: VaultData, requestId: string, note: string): Promise<void> {
  await data.call("vault.requests.decline", { requestId, ...(note.trim() ? { note: note.trim() } : {}) });
}

export async function revokeVaultExport(data: VaultData, exportId: string): Promise<void> {
  await data.call("vault.exports.revoke", { exportId });
}
