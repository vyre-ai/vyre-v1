// The host's one reading of a Vault key reference (host/src/seams/key-ref.ts), for this module: the item a held test read would send, so the card names it and Always allow approves it.
export interface KeyRef { id: string; handle: string; name: string; field?: string }
type Resolve = (ref: unknown, asker?: string) => KeyRef | null;

let current: Resolve | null = null;

export function setKeyRefResolver(next: Resolve | null): void { current = next; }
export function keyRefResolver(): Resolve | null { return current; }
