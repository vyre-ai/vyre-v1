// The Lock Vyre control (Cmd-L on a Mac, Ctrl-L elsewhere, and Cmd-K "Lock Vyre" / "Unlock"). KeyGate owns the key, so it registers what the shortcut and the command do; the shell only asks.

export interface LockControl {
  /** Is Vyre locked now (the key is not held for this person)? */
  locked(): boolean;
  /** Clear the key from this app and have the server forget it for this person in this Space. */
  lock(): Promise<void>;
  /** Open the password sheet. */
  unlock(): void;
}

let control: LockControl | null = null;

export function registerLockControl(c: LockControl | null): void { control = c; }
export const lockAvailable = (): boolean => control !== null;
export const isLocked = (): boolean => control?.locked() === true;

/** The shortcut: unlocked locks, locked opens the password sheet. False when there is no key to lock (a Space that holds none here). */
export function toggleLock(): boolean {
  if (control === null) return false;
  if (control.locked()) control.unlock(); else void control.lock();
  return true;
}
