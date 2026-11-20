// Did an event mean an AI account became available, and what may be said about it truly? One answer for every consumer that goes on when an account arrives (goals, the engine's sign-in resume, the routines' resume).
//   "account"  an AI account was connected: provider.added (a pasted key, a subscription sign-in, a Space key), a shared subscription turned ON, or a new Vault item of kind ai_subscription.
//   "saved"    an AI sign-in or key was saved: a new api_key item, or an item of kind ai_subscription or api_key that CHANGED (the update event carries its kind; an event from an older build has none, so the kind is read from the Vault by id, and a kind that cannot be read counts as saved, so a re-sign-in still resumes).
//   null       not an account: a share turned off (it takes an account away), a login, a card, a note or an OAuth token refresh (an update whose kind is known).
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
    const own = typeof e.payload?.["kind"] === "string" ? (e.payload["kind"] as string) : undefined;
    if (own !== undefined) return keyLike(own) ? "saved" : null;
    // An event from an older build carries no kind: ask the Vault. A consumer runs as the host, and the Vault refuses a Mine item it does not own, so a kind that cannot be read counts as saved: it fails toward resuming, never toward a turn that stays parked.
    const id = typeof e.payload?.["itemId"] === "string" ? (e.payload["itemId"] as string) : "";
    if (id === "") return null;
    const read = readKind ? await readKind(id).catch(() => undefined) : undefined;
    return read === undefined || keyLike(read) ? "saved" : null;
  }
  return null;
}

/** For a consumer that does not word anything: may an account have arrived? */
export const accountMayHaveArrived = async (e: Ev, readKind?: ReadKind): Promise<boolean> =>
  (await accountArrival(e, readKind)) !== null;
