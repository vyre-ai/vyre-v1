import type { StoredSession, VerifiedSpace } from "../shell/session/stored.ts";
import { openVerifiedSession } from "../shell/session/stored.ts";

interface ClaimedSession {
  def: { spaceId: string; name: string };
  me: { id: string };
  close(): void;
}

export interface ClaimedSessionDeps<T extends ClaimedSession> {
  open(): Promise<T>;
  getSpace(): Promise<VerifiedSpace>;
  persist(session: StoredSession): void;
}

/** Verify the claimed token against its authenticated Space before the shell can read it. */
export function storeClaimedOwnerSession<T extends ClaimedSession>(claim: { baseUrl: string; token: string; spaceId: string }, deps: ClaimedSessionDeps<T>): Promise<StoredSession> {
  return openVerifiedSession({
    baseUrl: claim.baseUrl,
    token: claim.token,
    continuity: { id: claim.spaceId },
    open: deps.open,
    getSpace: deps.getSpace,
    persist: deps.persist,
  });
}
