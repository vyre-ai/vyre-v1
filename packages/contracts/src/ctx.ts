// Handler context passed by the host to modules (ARCH 4.4). Types only; `host/src/invoke.ts` constructs it.
import type { CapName, EventName, Level, TraceContext } from './types.ts';
import type { EventEnvelope } from './envelope.ts';

export interface Principal { kind: 'person' | 'agent' | 'actor' | 'service'; id: string }
export interface ResourceRef { type: string; id: string | null; parent?: string }
export interface Decision { effect: 'allow' | 'deny' | 'hold'; reason: string; decisionId: string }
export interface ScopedDb { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
/**
 * afterFailure: the event is still written when the call ends in an error (a refused sign-in must leave its signin.failed in the log). It must be an event the capability declares; the host commits
 * it on its own once the handler has thrown, and the error still reaches the caller. A call that succeeds commits it with the rest.
 */
export interface EmitOpts { idempotencyKey?: string; vis?: EventEnvelope['vis']; cause?: string; afterFailure?: boolean }
/**
 * approvalToken: the Gate's token for a held act; the host lets the call through the hold it names, once (gate.release resume path).
 * onBehalfOf: the principal id of the original caller; the host runs the call as that principal, only for a call carrying a valid approvalToken.
 */
/** `gate: 'admin_only'` lets a call through the Gate unless a Space, owner or agent rule asks for approval; without it the Gate's default (hold) applies. */
/** The automation step a call comes from. The Gate matches the definition hash against the grants the automation holds; only steps-core sets it. */
export interface StepRef { automationId: string; nodeId: string; defHash: string; ask?: boolean }
export interface CallOpts { idempotencyKey?: string; traceId?: string; approvalToken?: string; onBehalfOf?: string; gate?: "admin_only"; step?: StepRef }
export interface Logger { debug(msg: string, attrs?: Record<string, unknown>): void; info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void; error(msg: string, attrs?: Record<string, unknown>): void }
/** What the host knows about one stored blob. `id` is opaque; `sha256` is the hex digest of the plain bytes. */
export interface BlobMeta { id: string; contentType: string; size: number; sha256: string; createdAt: number }
/**
 * ctx.blobs: binary storage scoped to the calling module (ARCH 4.1). A module sees only blobs it put itself; asking for another module's id is refused
 * (permission.no_grant), an id nobody stored is absent (get and stat return null, delete returns false). put refuses a blob over the size limit or a module over its quota (validation.too_large).
 */
/** What a blob belongs to. The store records it with the owning module at write time; the blob route checks the caller's read access on it (ruling 50). A blob put without one is served to nobody. */
export interface BlobResource { type: string; id: string }
export interface Blobs {
  put(bytes: Uint8Array, contentType: string, opts?: { resource?: BlobResource }): Promise<BlobMeta>;
  get(id: string): Promise<{ meta: BlobMeta; bytes: Uint8Array } | null>;
  stat(id: string): Promise<BlobMeta | null>;
  delete(id: string): Promise<boolean>;
}
export interface Sealed { keyId: string; nonce: string; bytes: string }

export interface Ctx {
  space: string;
  principal: Principal;
  actingFor?: string;
  /** Set only on the engine's post of a turn a key of the Space paid for. */
  sharedKey?: boolean;
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
  /** `cap` names the capability the check stands in for, so the Space's Gate rules for that capability apply (a handler that changes a record on behalf of records.update asks as records.update). `fields` names the fields the check is about, so a field the caller may not read counts against them. A call a person approved (a parked call that was released) carries that approval into these checks: what the approval covered is not held again. */
  authorize(action: { perm: string | null; level: Level; cap?: string; fields?: readonly string[] }, resource: ResourceRef): Decision;
  /**
   * May every one of these people do this on this resource? Their own grants, checked one by one, never the caller's. What goes into a chat other people read is held to what every one of them may
   * open (lib/audience.ts). Answers yes or no only. Present on a booted daemon; a hand-built test ctx may omit it.
   */
  mayAll?(people: readonly string[], action: { perm: string | null; level: Level }, resource: ResourceRef): boolean;
  vault: { fill(handle: string, into: { kind: string; ref: string }): Promise<void>; use(handle: string): { handle: string } };
  http: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
  log: Logger;
  schedule(at: number | string, cap: CapName, input: unknown): Promise<string>;
  seal: { seal(v: Uint8Array, scope: string): Sealed; unseal(s: Sealed): Uint8Array };
  /** Present on a booted daemon; a hand-built test ctx may omit it. */
  blobs?: Blobs;
}
