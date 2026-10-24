// Replica store types (ARCH 5.10, 5.11). One interface for node:sqlite, expo-sqlite and wa-sqlite.
import type { DeviceClass } from "../protocol.ts";

export type { DeviceClass };

/** Ranks match contracts labels: public, internal, confidential, restricted. */
export const LABEL_RANK = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
export type LabelName = keyof typeof LABEL_RANK;

/** Above this rank a row is never mirrored. Restricted is rank 3, on every device class. */
export const RESTRICTED_RANK = LABEL_RANK.restricted;

/** Desktop and web ceiling. A phone policy can only lower this (ARCH 5.11). */
export const DEVICE_LABEL_CEILING: Record<DeviceClass, number> = {
  desktop: LABEL_RANK.confidential,
  web: LABEL_RANK.confidential,
  phone: LABEL_RANK.confidential,
};

/** Blob LRU budgets from ARCH 5.11. Phone 300 MB, desktop and web 2 GB. */
export const BLOB_BUDGET_BYTES: Record<DeviceClass, number> = {
  desktop: 2 * 1024 * 1024 * 1024,
  web: 2 * 1024 * 1024 * 1024,
  phone: 300 * 1024 * 1024,
};

export type ProfileMode = "all" | "window" | "none";
export type WriteOrigin = "local" | "mirror";

export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

export type ReplicaReason =
  | "ok"
  | "profile_none"
  | "restricted"
  | "above_label"
  | "outside_window"
  | "not_owned"
  | "hidden"
  | "older";

export interface ReplicaWriteResult {
  applied: boolean;
  reason: ReplicaReason;
}

/** A local edit or a mirrored row. Both go through ReplicaStore.write. */
export interface ReplicaWrite {
  entity: string;
  id: string;
  fields: Record<string, SqlValue | boolean>;
  hlc: string;
  actor: string;
  origin?: WriteOrigin;
  /** Row label. A number is a rank. Restricted is never stored. */
  label?: LabelName | number;
  /** Server change seq. A seq at or below a recorded hide is dropped. */
  seq?: number;
  starred?: boolean;
  follows?: boolean;
  /** When set, the same transaction appends one outbox row. */
  op?: PendingOp;
}

export interface PendingOp {
  opId: string;
  traceId: string;
  cap: string;
  v: number;
  input: string;
  baseSeq: string;
}

export interface SubscribeMatch {
  entity: string;
  id?: string;
}

export interface EntityInfo {
  kind: "entity" | "record_type";
  key: string;
  table: string;
  profile: Record<DeviceClass, ProfileMode>;
  window: { days?: number; starred?: boolean; recentCount?: number };
  /** Null when the entity does not set maxLabel. */
  maxLabel: number | null;
  fts: string[];
  ownerField: string | null;
  /** Field key to label rank, only for fields that declare a label. */
  fieldLabels: Record<string, number>;
  datetimeFields: string[];
}

export interface OpenReplicaOptions {
  driver: SqlDriver;
  deviceClass: DeviceClass;
  registryHash: string;
  /** Phone only. Default confidential. Cannot raise the ceiling, only lower it. */
  phoneCeiling?: LabelName;
  personId?: string;
  clock?: () => number;
  /** Test and embed hook. Bytes. Default is the profile budget. */
  blobBudgetBytes?: number;
  /**
   * Async openers pass the hash they already read. Omit it and the store reads sync_state.
   * Null means the file has no hash yet.
   */
  storedRegistryHash?: string | null;
  /** Async openers pass tables to drop when the hash changed. Omit it and the store lists them. */
  rebuildTargets?: readonly RebuildTarget[];
  /** Async openers pass hide rows read before open. Omit it and the store reads hide_seq. */
  hideRows?: readonly HideRow[];
  /** Async openers pass starred ids (`entity` + NUL + `id`) read before open. */
  starredKeys?: readonly string[];
  /** Async openers pass followed ids (`entity` + NUL + `id`) read before open. */
  followsKeys?: readonly string[];
}

export interface RebuildTarget {
  name: string;
  virtual: boolean;
}

export interface HideRow {
  entity: string;
  id: string;
  seq: number;
}

export interface ReplicaStore {
  readonly deviceClass: DeviceClass;
  readonly registryHash: string;
  /** True when this open rebuilt the schema because the registry hash changed. */
  readonly upgraded: boolean;
  /** Prepared statements created during open, before any write. */
  readonly preparedCount: number;
  /** SQL write plus invalidation. Returns after the sync engine commits. Async engines queue SQL and still invalidate before return. */
  write(input: ReplicaWrite): ReplicaWriteResult;
  read(entity: string, id: string): SqlRow | null;
  hide(entity: string, id: string, seq: number): void;
  subscribe(match: SubscribeMatch, fn: () => void): () => void;
  putBlob(hash: string, bytes: Uint8Array): void;
  getBlob(hash: string): Uint8Array | null;
  readFts(entity: string, id: string): { title: string; body: string } | null;
  pendingCount(): number;
  getState(key: string): string | null;
  hasTable(name: string): boolean;
  /** Pull one row into the read cache. Sync engines resolve from SQL. */
  load(entity: string, id: string): Promise<SqlRow | null>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class ReplicaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReplicaError";
    this.code = code;
  }
}

/** Synchronous SQL. Async engines queue the work and finish it in flush. */
export interface SqlDriver {
  readonly kind: "node" | "expo" | "wa";
  /** True when run and get finish before they return. */
  readonly sync: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  transaction(fn: () => void): void;
  query(sql: string, params: readonly SqlValue[]): Promise<SqlRow | undefined>;
  flush(): Promise<void>;
  close(): void;
}

export interface SqlStatement {
  run(params: readonly SqlValue[]): void;
  get(params: readonly SqlValue[]): SqlRow | undefined;
  all(params: readonly SqlValue[]): SqlRow[];
}
