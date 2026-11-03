// Where an app hub's key goes when the hub card connects it (skills audit, Part 3 gap 1). A hub is one Space-wide connection, and the Vault fills its handle as the person whose agent calls the hub, so
// the key has to sit where every member's call can read it: a Shared folder of the Space. Filed in the admin's own (Mine) folder, only the admin's calls could fill it and every other member's
// call to the hub was refused. Plain logic, so a live test drives exactly what the card does.

export type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The Shared folder the card files Space keys in when the Space has none yet. */
export const HUB_KEY_FOLDER = "Connections";

const key = (): string => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Puts the hub's key in a Shared Vault folder (the Space's first, or a new "Connections" one) and answers the handle the connection keeps. The value never comes back. */
export async function fileHubKey(call: Call, hubName: string, value: string): Promise<string> {
  const folders = ((await call("vault.folders.list", {})) as { folders: { id: string; scope: string }[] }).folders;
  const folderId = folders.find((f) => f.scope === "shared")?.id ?? ((await call("vault.folders.create", { name: HUB_KEY_FOLDER, scope: "shared", idempotencyKey: key() })) as { folder: { id: string } }).folder.id;
  const itemName = `${hubName}_key`;
  await call("vault.item.put", { folderId, name: itemName, kind: "api_key", fields: [{ key: "api_key", value, secret: true }], idempotencyKey: key() });
  return `#${itemName}.api_key`;
}
