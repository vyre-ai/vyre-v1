// "Use the same AI account here" (owner ruling Q4). A person with an AI key in their Personal Space can copy that one key into their own private Mine folder in a Team Space,
// only when they say yes, and only while they are present at this device. Never automatic, never shared: it goes to providers.add with scope "mine". The value is read with
// vault.item.reveal (a person at View level, logged), held in memory for the one call, and not stored, shown or put in any chat line. A subscription sign-in is not a key and cannot be
// copied; the person signs in again for it.
import type { CapCall } from "../shell/session/caps.ts";

export interface CopyableAccount { providerId: string; providerKey: string; name: string; itemId: string }

type AccountRow = { providerId?: string; provider?: string; name?: string; title: string; kind: string; mine: boolean; status: string; itemId?: string; base?: string; keyless?: boolean };

export async function copyableAccounts(personal: CapCall): Promise<CopyableAccount[]> {
  const out = await personal("engine.accounts.list", {}) as { accounts: AccountRow[] };
  return out.accounts
    .filter((a) => a.kind === "api_key" && a.mine && a.status === "ok" && a.base === undefined && a.keyless !== true && a.providerId !== undefined && a.provider !== undefined && a.itemId !== undefined)
    .map((a) => ({ providerId: a.providerId!, providerKey: a.provider!, name: a.name ?? a.title, itemId: a.itemId! }));
}

/** Copies one account into the team Space's Mine folder. Resolves with the new provider id. The reveal and the add are the only two calls; nothing else sees the value. */
export async function copyAccount(personal: CapCall, team: CapCall, account: CopyableAccount, idempotencyKey: string): Promise<string> {
  let value = "";
  try {
    const shown = await personal("vault.item.reveal", { itemId: account.itemId, fields: ["api_key"], reason: "Use the same AI account in another Space" }) as { fields: { key: string; value: string }[] };
    value = shown.fields.find((f) => f.key === "api_key")?.value ?? "";
    if (value === "") throw new Error("This account has no key to copy.");
    const added = await team("providers.add", { providerKey: account.providerKey, connection: "api_key", apiKey: value, scope: "mine", idempotencyKey }) as { provider: { id: string } };
    return added.provider.id;
  } catch (e) {
    // a plain line; the key is never in it
    throw new Error(e instanceof Error && e.message === "This account has no key to copy." ? e.message : "Could not copy this account. Add it here with its key instead.");
  } finally {
    value = "";
  }
}
