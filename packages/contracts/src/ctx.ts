// Handler context passed by the host to modules (ARCH 4.4). Types only; `host/src/invoke.ts` constructs it.
import type { CapName, EventName, Level, TraceContext } from './types.ts';
import type { EventEnvelope } from './envelope.ts';

export interface Principal { kind: 'person' | 'agent' | 'actor' | 'service'; id: string }
export interface ResourceRef { type: string; id: string | null; parent?: string }
export interface Decision { effect: 'allow' | 'deny' | 'hold'; reason: string; decisionId: string }
export interface ScopedDb { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
export interface EmitOpts { idempotencyKey?: string; vis?: EventEnvelope['vis']; cause?: string }
/**
 * `approval` and `as` are the Gate's resume path (contract change 5): only gate.release may use them. The host re-invokes the parked call as its original caller (`as`) with the sealed approval
 * token, which the Gate hook accepts for exactly the payload it was minted for. From any other capability both are ignored.
 */
export interface CallOpts {
  idempotencyKey?: string;
  traceId?: string;
  approval?: string;
  as?: { principal: Principal; actingFor?: string | undefined; run?: string | undefined; thread?: string | undefined };
}
export interface Logger { debug(msg: string, attrs?: Record<string, unknown>): void; info(msg: string, attrs?: Record<string, unknown>): void; warn(msg: string, attrs?: Record<string, unknown>): void; error(msg: string, attrs?: Record<string, unknown>): void }
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
}
