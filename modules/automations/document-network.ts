// The network openDocument uses, when a host installs one.
// Null means platform fetch and DNS. The action input does not carry this.

import type { FetchDeps } from "./public-fetch.ts";

let current: FetchDeps | null = null;

export function setDocumentNetwork(next: FetchDeps | null): void {
  current = next;
}

export function documentNetwork(): FetchDeps | null {
  return current;
}
