// What the host gives the computers module to search the web with a key: the Space's own Vault handle for the search service, read for one call. Null means no Vault is bound (a test, or a host without one).
export interface SearchHost {
  /** The key a Vault handle names, for this one call. Throws when the handle cannot be read. */
  secret(handle: string): Promise<string>;
}
let current: SearchHost | null = null;
export function setSearchHost(h: SearchHost | null): void {
  current = h;
}
export function searchHost(): SearchHost | null {
  return current;
}
