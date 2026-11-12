// The host's one reading of a Vault key reference (host/src/seams/key-ref.ts), for this module: the item a held test read would send, so the card names it and Always allow approves it.
export interface KeyRef { id: string; handle: string; name: string; field?: string }
type Resolve = (ref: unknown, asker?: string) => KeyRef | null;

let current: Resolve | null = null;

export function setKeyRefResolver(next: Resolve | null): void { current = next; }
export function keyRefResolver(): Resolve | null { return current; }

/** The Space's own public address (https://...), from the host; null when it has none that carries web requests (the relay's vyre.run name carries only forms and sites). */
let publicBase: (() => string | null) | null = null;
export function setPublicBase(next: (() => string | null) | null): void { publicBase = next; }
export function hookBase(): string | null { try { return publicBase ? publicBase() : null; } catch { return null; } }

/** The Vault items a person may use (handle, lower case, to item id), asked as that person: the update's backfill records a step's host only for a key its publisher may use. */
let usableBy: ((person: string) => Promise<ReadonlyMap<string, string>>) | null = null;
export function setKeyUsableBy(next: ((person: string) => Promise<ReadonlyMap<string, string>>) | null): void { usableBy = next; }
export function keyUsableBy(): ((person: string) => Promise<ReadonlyMap<string, string>>) | null { return usableBy; }
