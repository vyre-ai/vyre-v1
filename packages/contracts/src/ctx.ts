// Handler context passed by the host to modules (ARCH 4.4). Types only; `host/src/invoke.ts` constructs it.
import type { CapName, EventName, Level, TraceContext } from './types.ts';
import type { EventEnvelope } from './envelope.ts';

export interface Principal { kind: 'person' | 'agent' | 'actor' | 'service'; id: string }
export interface ResourceRef { type: string; id: string | null; parent?: string }
export interface Decision { effect: 'allow' | 'deny' | 'hold'; reason: string; decisionId: string }
export interface ScopedDb { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
export interface EmitOpts { idempotencyKey?: string; vis?: EventEnvelope['vis']; cause?: string }
/**
 * approvalToken: the Gate's token for a held act; the host lets the call through the hold it names, once (gate.release resume path).
 * onBehalfOf: the principal id of the original caller; the host runs the call as that principal, only for a call carrying a valid approvalToken.
 */
export interface CallOpts { idempotencyKey?: string; traceId?: string; approvalToken?: string; onBehalfOf?: string }
export interface Logger { debug(msg: string, attrs?: Record<string, unknown>): void; info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void; error(msg: string, attrs?: Record<string, unknown>): void }
/** What the host knows about one stored blob. `id` is opaque; `sha256` is the hex digest of the plain bytes. */
export interface BlobMeta { id: string; contentType: string; size: number; sha256: string; createdAt: number }
/**
 * ctx.blobs: binary storage scoped to the calling module (ARCH 4.1). A module sees only blobs it put itself; asking for another module's id is refused
 * (permission.no_grant), an id nobody stored is absent (get and stat return null, delete returns false). put refuses a blob over the size limit or a module over its quota (validation.too_large).
 */
export interface Blobs {
  put(bytes: Uint8Array, contentType: string): Promise<BlobMeta>;
  get(id: string): Promise<{ meta: BlobMeta; bytes: Uint8Array } | null>;
  stat(id: string): Promise<BlobMeta | null>;
  delete(id: string): Promise<boolean>;
}
export interface Sealed { keyId: string; nonce: string; bytes: string }

export interface Ctx {
  space: string;
  principal: Principal;
  actingFor?: string;
  trace: TraceContext;
  run?: string;
  thread?: string;
  origin: string;
  depth: number;
  device?: string;
  now(): number;
  db: ScopedDb;
  emit<T>(name: EventName, subject: string, payload: T, opts?: EmitOpts): EventEnvelope<T>;
  call<C extends CapName>(cap: C, input: unknown, opts?: CallOpts): Promise<unknown>;
  authorize(action: { perm: string | null; level: Level }, resource: ResourceRef): Decision;
  vault: { fill(handle: string, into: { kind: string; ref: string }): Promise<void>; use(handle: string): { handle: string } };
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: Logger;
  schedule(at: number | string, cap: CapName, input: unknown): Promise<string>;
  seal: { seal(v: Uint8Array, scope: string): Sealed; unseal(s: Sealed): Uint8Array };
  /** Present on a booted daemon; a hand-built test ctx may omit it. */
  blobs?: Blobs;
}
