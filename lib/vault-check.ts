// A Vault handle a capability keeps for the server to read later as itself (a mailbox password the poll logs in with, a connection's secret, a sign-in app's secret) is checked as the caller first:
// they must have Use on the item now, or anyone could point the server at a key they cannot use and have it sent to a server they run (vault audit, Broken 17). vault.use answers the handle and the
// field names, never a value, and leaves a "used" line on the item. A Restricted company key is refused to everyone below its clearance the same way.
export type Call = (cap: string, input: unknown) => Promise<unknown>;

export const CANNOT_USE =
  "You cannot use that Vault item, so it cannot be kept here. Choose an item you can use, or ask whoever shares it.";

/** The item a handle names, without its field. */
export const itemOfHandle = (handle: string): string =>
  `#${handle.replace(/^#/, "").replace(/\.[A-Za-z][A-Za-z0-9_]*$/, "")}`;

/** The item named as the caller wrote it (never a value): "#Fathom". */
export const missingItemLine = (handle: string): string =>
  `There is no Vault item ${itemOfHandle(handle)} that you can use. Check it is still in the Vault, or ask for the key.`;
export const restrictedItemLine = (handle: string): string =>
  `${itemOfHandle(handle)} is in a Restricted place, so it cannot be kept here. Move it to your own keys in the Vault, or to a folder that is not restricted, and try again.`;

const codeOf = (e: unknown): string | undefined => {
  const x = e as { code?: unknown; error?: { code?: unknown } } | null;
  const c = x?.error?.code ?? x?.code;
  return typeof c === "string" ? c : undefined;
};

/**
 * Resolves when the caller has Use on the handle's item; otherwise rejects with `refuse(CANNOT_USE)`'s error. `missingOk`: an item that is not in the Vault yet passes (an admin setting up a sign-in
 * app before pasting its secret); an item that is there and is not theirs never does.
 */
export async function mustUse(
  call: Call,
  handle: string,
  refuse: (message: string) => never,
  o: { missingOk?: boolean } = {},
): Promise<void> {
  try {
    await call("vault.use", { item: itemOfHandle(handle), purpose: "kept for the server to use" });
  } catch (e) {
    const code = codeOf(e);
    if (o.missingOk === true && code === "validation.not_found") return;
    // three different refusals, three different words: the item is not there (or not open to the caller, which reads the same), it is Restricted, or it is simply not theirs to use
    if (code === "validation.not_found" || code === "permission.not_found") refuse(missingItemLine(handle));
    if (code === "permission.above_clearance") refuse(restrictedItemLine(handle));
    refuse(CANNOT_USE);
  }
}
