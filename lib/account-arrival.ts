// Did an event mean an AI account became available, and what may be said about it truly? One answer for every consumer that goes on when an account arrives (goals, the engine's sign-in resume, the routines' resume).
//   "account"  an AI account was connected: provider.added (a pasted key, a subscription sign-in, a Space key), a shared subscription turned ON, or a new Vault item of kind ai_subscription.
//   "saved"    an AI sign-in or key was saved: a new api_key item, or an item of kind ai_subscription or api_key that CHANGED (the update event carries no kind, so it is read from the Vault, once, by id).
//   null       not an account: a share turned off (it takes an account away), a login, a card, a note or an OAuth token refresh, and an update whose kind cannot be read.
export type Arrival = "account" | "saved" | null;
export type ReadKind = (itemId: string) => Promise<string | undefined>;
type Ev = { name: string; payload?: Record<string, unknown> | undefined };

/** The kind of a Vault item, read once by id through the capabilities a consumer may call; undefined when it cannot be read. */
export const kindReader = (
  call: ((cap: string, input: unknown) => Promise<unknown>) | undefined,
): ReadKind | undefined =>
  call
    ? async (itemId) => {
        const r = (await call("vault.item.get", { itemId }).catch(() => null)) as { item?: { kind?: unknown } } | null;
        return typeof r?.item?.kind === "string" ? r.item.kind : undefined;
      }
    : undefined;

const keyLike = (kind: string | undefined): boolean => kind === "api_key" || kind === "ai_subscription";

export async function accountArrival(e: Ev, readKind?: ReadKind): Promise<Arrival> {
  if (e.name === "provider.added") return "account";
  if (e.name === "engine.subscription_share_changed") return e.payload?.["enabled"] === true ? "account" : null;
  if (e.name === "vault.item_created") {
    const kind = typeof e.payload?.["kind"] === "string" ? (e.payload["kind"] as string) : undefined;
    return kind === "ai_subscription" ? "account" : kind === "api_key" ? "saved" : null;
  }
  if (e.name === "vault.item_updated") {
    const id = typeof e.payload?.["itemId"] === "string" ? (e.payload["itemId"] as string) : "";
    if (id === "" || !readKind) return null;
    return keyLike(await readKind(id).catch(() => undefined)) ? "saved" : null;
  }
  return null;
}

/** For a consumer that does not word anything: may an account have arrived? */
export const accountMayHaveArrived = async (e: Ev, readKind?: ReadKind): Promise<boolean> =>
  (await accountArrival(e, readKind)) !== null;
