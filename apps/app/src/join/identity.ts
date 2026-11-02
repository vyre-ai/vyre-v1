// One Vyre account across Spaces (rc.14): only the username, the password, GitHub sign-in and devices are universal. When this device is already signed in to a Space as someone, owning
// or joining another Space uses that account: the person types the current password, the bundle they already have opens with it, and the same person key, wraps and key pair go to the
// new Space with a fresh Space key. No new password and no new recovery code.
import type { MadeBundle, SealedSpaceKey, StoredBundle } from "../../../../client/src/crypto/keys.ts";
import type { StoredSession } from "../shell/session/stored.ts";

/** The account this device already knows: who it is, and the Space session that can hand back its key bundle. */
export interface KnownIdentity { username: string; name: string; baseUrl: string; token: string; spaceId: string; spaceName: string }

/** The account to offer for a new Space: the Personal Space's first, else any signed-in Space with a username. Never the Space being set up or joined. */
export function knownIdentity(sessions: readonly StoredSession[], target: { spaceId?: string | null; baseUrl?: string | null } = {}): KnownIdentity | null {
  const usable = sessions.filter((s) => !!s.username && !!s.token && s.def.spaceId !== target.spaceId && s.baseUrl !== target.baseUrl);
  const pick = usable.find((s) => s.def.kind === "personal") ?? usable[0];
  if (!pick?.username) return null;
  return { username: pick.username, name: pick.displayName?.trim() || pick.username, baseUrl: pick.baseUrl, token: pick.token, spaceId: pick.def.spaceId, spaceName: pick.def.name };
}

export type CarryFailure = "password" | "unreachable" | "no_keys";
export class CarryError extends Error {
  readonly failure: CarryFailure;
  constructor(failure: CarryFailure, message: string) { super(message); this.name = "CarryError"; this.failure = failure; }
  /** The line a screen shows. */
  get line(): string { return this.message; }
}

export const CARRY_LINE: Readonly<Record<CarryFailure, string>> = {
  password: "That password is not right.",
  unreachable: "Couldn't reach your Space on this device. Try again, or use a different account.",
  no_keys: "This account has no keys to bring. Use a different account.",
};

export interface CarryDeps {
  /** A caller signed in to the Space that holds the account (the known identity's session). */
  source: (capability: string, input: unknown) => Promise<unknown>;
  carryBundle(password: string, bundle: StoredBundle, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }>;
}

/** The bundle for the new Space, opened with the current password. Throws CarryError; a wrong password reads as one plain line. The caller wipes `personKey`. */
export async function carryIdentity(deps: CarryDeps, password: string, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }> {
  let keys: StoredBundle | undefined;
  try { keys = ((await deps.source("identity.keys_get", {})) as { keys?: StoredBundle }).keys; } catch (e) {
    if ((e as { code?: string } | null)?.code === "validation.not_found") throw new CarryError("no_keys", CARRY_LINE.no_keys);
    throw new CarryError("unreachable", CARRY_LINE.unreachable);
  }
  if (!keys?.personKeyByPassword || !keys.publicKey || !keys.privateKeyWrapped) throw new CarryError("no_keys", CARRY_LINE.no_keys);
  try { return await deps.carryBundle(password, keys, spaceId); } catch (e) {
    if ((e as { code?: string } | null)?.code === "bad_secret") throw new CarryError("password", CARRY_LINE.password);
    throw e;
  }
}
