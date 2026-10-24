// The ports the connector seams stand on. The host owns the choice of implementation (the Vault module, the Files module, the blob store); a seam only calls these.
// Layer rule (boundaries.json): host never imports modules, so the context types here are the small structural subset a seam reads. A module's own context satisfies them.
import type { RawDb } from "../ctx/db.ts";

export interface SeamCtx {
  space: string;
  trace: { traceId: string };
  now(): number;
  /** the calling module's own scoped database */
  db: Pick<RawDb, "all">;
}

/** The Vault, as the seams need it. Values are released at the last moment, one call at a time, and never logged or stored by a seam. */
export interface VaultPort {
  /** The item's value as text (a password, or the JSON of a service-account key). */
  secret(handle: string, space: string): Promise<string>;
  /** Sign `data` with the RSA private key held in the item (the JSON field private_key), RS256, returned base64url. The key never leaves the Vault. */
  signRs256(handle: string, space: string, data: string): Promise<string>;
}

export interface FetchedResponse {
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type SeamFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<FetchedResponse>;

export interface SpaceFiles { read(space: string, fileId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }> }
export interface SpaceBlobs { put(space: string, bytes: Uint8Array, mime: string): Promise<string> }
export interface SpaceMembers { emails(space: string): Promise<{ userId: string; email: string }[]> }

export const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
