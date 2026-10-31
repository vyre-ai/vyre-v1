// One gate for a locked Mine vault key. Any call that comes back "your vault key is locked" (a reveal, a copy, an edit, a share, an export, a provider or an onboarding key) is
// held, the page's one "Unlock your Vault" prompt asks for the password in place, and the call is sent again once the key is open. Nobody is signed out; Cancel gives the original refusal.
// The prompt is drawn by VaultUnlockHost (shell/spaces); this file is the pure part: recognising the refusal, and the queue between a call and the prompt.

/** The daemon says a vault key is locked by its reason, or (older daemons) in these words. A person stays signed in. */
export function isVaultLockedError(e: unknown): boolean {
  const x = e as { message?: string; details?: { reason?: string }; error?: { message?: string; details?: { reason?: string } } } | null | undefined;
  return x?.details?.reason === "vault_locked" || x?.error?.details?.reason === "vault_locked" || /vault key is locked/i.test(x?.message ?? x?.error?.message ?? "");
}

export type Unlock = (password: string) => Promise<void>;
/** What the prompt does with one request: ask for the password, run `unlock` until it works or the person cancels. True when the key is open. */
export type Asker = (unlock: Unlock) => Promise<boolean>;

let asker: Asker | null = null;
let open: Promise<boolean> | null = null;

/** The prompt registers itself while it is mounted, and takes itself away when it goes. */
export function registerVaultPrompt(a: Asker | null): void { asker = a; }

/** Ask once, however many calls are waiting: they all share the one prompt and its answer. False when no prompt is mounted. */
export function askVaultUnlock(unlock: Unlock): Promise<boolean> {
  if (!asker) return Promise.resolve(false);
  if (open) return open;
  const run = asker(unlock).finally(() => { open = null; });
  open = run;
  return run;
}

/** Wraps a call: a locked-vault refusal waits for the prompt and, when the key opens, sends the same call again once. Anything else passes through untouched. */
export function withVaultGate<A extends unknown[], R>(call: (...a: A) => Promise<R>, unlock: Unlock | undefined): (...a: A) => Promise<R> {
  return async (...a: A): Promise<R> => {
    try { return await call(...a); }
    catch (e) {
      if (!unlock || !isVaultLockedError(e) || !(await askVaultUnlock(unlock))) throw e;
      return call(...a);
    }
  };
}
