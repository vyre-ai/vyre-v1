import type { VaultData } from "./data.tsx";

export type RequestFulfilment =
  | { itemId: string }
  | { fields: { key: string; value: string }[]; folderId?: string | undefined };

export async function fulfilVaultRequest(data: VaultData, requestId: string, fulfilment: RequestFulfilment): Promise<void> {
  await data.call("vault.requests.fulfil", { requestId, ...fulfilment });
}

export async function declineVaultRequest(data: VaultData, requestId: string, note: string): Promise<void> {
  await data.call("vault.requests.decline", { requestId, ...(note.trim() ? { note: note.trim() } : {}) });
}

export async function revokeVaultExport(data: VaultData, exportId: string): Promise<void> {
  await data.call("vault.exports.revoke", { exportId });
}
