// Event log types (ARCH 4.2). The envelope is the JSON stored in events.event; payload bytes live in their own column so they can be erased without touching the chain.

export type Vis = "space" | "participants" | "owner" | "private";

/** What an emitter hands to append(). */
export interface NewEvent {
  /** Minted by the emitter so a retry appends once. The store mints one when absent. */
  id?: string;
  type: string;
  sv: number;
  /** Client or server hlc text. A client hlc more than 5 minutes ahead is clamped and `skew_ms` recorded. */
  hlc?: string;
  trace_id: string;
  span_id?: string;
  actor: string;
  on_behalf?: string;
  device?: string;
  run_id?: string;
  cause?: string;
  origin?: string;
  depth?: number;
  entity?: string;
  entity_id?: string;
  /** Keys of changed fields (no values), for filters. */
  fields?: string[];
  label?: number;
  vis: Vis;
  enc?: 0 | 1 | 2;
  key_id?: string;
  /** base64 */
  nonce?: string;
  /** JSON-able value, or ciphertext bytes when enc > 0. */
  payload: unknown;
}

export interface Envelope {
  seq: number;
  id: string;
  type: string;
  sv: number;
  hlc: string;
  at: number;
  skew_ms?: number;
  trace_id: string;
  span_id?: string;
  actor: string;
  on_behalf?: string;
  device?: string;
  run_id?: string;
  cause?: string;
  origin?: string;
  depth: number;
  entity?: string;
  entity_id?: string;
  fields?: string[];
  label: number;
  vis: Vis;
  enc: number;
  key_id?: string;
  nonce?: string;
  /** hex of sha256(salt || payload bytes) */
  commit: string;
  /** hash of the event before, hex */
  prev: string;
  /** hash of this envelope without `hash` */
  hash: string;
}

export interface StoredEvent extends Envelope {
  payload: Uint8Array;
}

export interface ReadQuery {
  after?: number;
  before?: number;
  /** exact type or `noun.*` */
  type?: string;
  entity?: string;
  entity_id?: string;
  run_id?: string;
  trace_id?: string;
  limit?: number;
}

export type VerifyResult = { ok: true; head: string; seq: number } | { ok: false; at: number; why: string };

export type AppendResult = { ok: true; event: StoredEvent; duplicate: boolean } | { ok: false; code: string; message: string };
