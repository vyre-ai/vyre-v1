// The ports of the push server (ARCH 5.4). Push decides what to apply; the capability itself runs through `invoke` as the person, so permissions, Gate, validation and audit are the normal ones.
// Everything the server needs from outside is named here and injected, so the core runs against a real log in tests and against the host in production.
import type { VyreError } from "../../../../packages/contracts/src/types.ts";
import type { ConflictNotice } from "../../protocol.ts";
import type { FieldState, Policy } from "./merge.ts";

export interface PushWho {
  /** The person the device session belongs to. */
  person: string;
  device: string;
}

/** One capability call made for an op. For a patch the input carries only the fields that won. */
export interface InvokeCall {
  cap: string;
  v: number;
  input: unknown;
  entity?: string;
  id?: string;
  principal: string;
  deviceId: string;
  traceId: string;
  /** The op id: also the capability's idempotency key. */
  idempotencyKey: string;
  /** The op's hlc after the clamp; events written for the op carry it, which is what field clocks compare. */
  hlc: string;
}
export type InvokeResult = { kind: "applied"; seq: number } | { kind: "held"; taskId: string };

export interface HistoryEntry {
  entity: string;
  id: string;
  field: string;
  value: unknown;
  hlc: string;
  actor: string;
  seq: number;
  reason: "lww_loser";
}

export interface ConflictOpen {
  entity: string;
  id: string;
  field: string;
  ours: unknown;
  theirs: unknown;
  base: number;
  oursActor: string;
  theirsActor: string;
  opId: string;
  traceId: string;
  deviceId: string;
  /** Restricted fields never go to a provider: the person chooses between two plain values. */
  plainChoice: boolean;
}

export interface PushDeps {
  now(): number;
  hlc(): string;
  /** The person's sync epoch; a device below it is revoked. */
  epochOf(person: string): number | Promise<number>;
  /** Run the capability as the person. Throws a VyreErr when it is refused. */
  invoke(call: InvokeCall): Promise<InvokeResult>;
  /** Current clock of every field of a row (`field_meta`). Empty for a row the server does not have. */
  clocks(entity: string, id: string): Promise<Record<string, FieldState>> | Record<string, FieldState>;
  /** The seq a queued op was applied at, for `after` links. */
  appliedSeq(opId: string): Promise<number | undefined> | number | undefined;
  /** Merge policy of a field. */
  policy(entity: string, field: string): Policy;
  /** True when the field is labelled Restricted. */
  restricted(entity: string, field: string): boolean;
  /** Keep a value that lost (or was displaced) in field history. Idempotent per (entity, id, field, hlc, actor): a retried op may call it again. */
  history(entry: HistoryEntry): Promise<void> | void;
  /** Park a conflict for the assistant and emit conflict.opened; returns the conflict id. Idempotent per (opId, field): a retried op gets the same id. */
  openConflict(c: ConflictOpen): Promise<string> | string;
  /** Idempotent effects: the first result of a key is the result every retry gets. */
  once<T>(principal: string, cap: string, key: string, input: unknown, run: () => Promise<T>): Promise<T>;
}

export type OpOutcome =
  | { kind: "applied"; seq: number; conflicts: ConflictNotice[]; lost: string[] }
  | { kind: "held"; taskId: string }
  | { kind: "rejected"; error: VyreError; copyOut: unknown };
