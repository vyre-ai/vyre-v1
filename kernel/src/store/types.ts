// The Store interface (ARCH 4.3.1), ported from the 0.6 kernel/contracts/store.d.ts. It is the contract of the records module's RecordStore and of every connector SyncedTypeDef target,
// and the conformance suite (kernel/conformance/suite.ts) is its definition. Field and type shapes are kept loose here; the generated contracts package narrows them later.

export type FieldValue = unknown;
export type RecordId = string;

export interface FieldDef { name: string; kind: string; label?: string; required?: boolean; unique?: boolean; options?: string[]; many?: boolean; to?: string; [k: string]: unknown }
export interface TypeDef { name: string; label?: string; fields: FieldDef[]; [k: string]: unknown }

export interface StoredRecord {
  readonly type: string;
  readonly id: RecordId;
  readonly version: number;
  readonly data: Readonly<Record<string, FieldValue>>;
  readonly created_at: number;
  readonly updated_at: number;
  readonly deleted_at?: number;
}

export interface DefineDiff { add_types?: readonly TypeDef[]; change_types?: readonly TypeDef[]; remove_types?: readonly string[] }
export interface DefineResult { applied: boolean; changes: readonly string[] }

export type FilterOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "contains" | "is_null";
export type Filter =
  | { and: readonly Filter[] }
  | { or: readonly Filter[] }
  | { not: Filter }
  | { field: string; op: FilterOp; value?: FieldValue };

export interface Sort { field: string; dir: "asc" | "desc" }
export interface PageRequest { limit: number; cursor?: string }
export interface Page<T> { rows: readonly T[]; next_cursor?: string }
export interface QuerySpec { filter?: Filter; sort?: readonly Sort[]; page: PageRequest; include_deleted?: boolean }
export interface AggregateSpec { filter?: Filter; group_by?: readonly string[]; measures: readonly { fn: "count" | "sum" | "min" | "max" | "avg"; field?: string }[] }
export interface AggregateRow { group: Record<string, FieldValue>; values: Record<string, number | null> }
export interface SearchSpec { text: string; types?: readonly string[]; page: PageRequest }
export interface SearchHit { type: string; id: RecordId; score: number; snippet?: string }

export interface ChangeEntry {
  cursor: string; type: string; id: RecordId; kind: "created" | "updated" | "removed" | "restored"; version: number; at: number;
  before?: Record<string, FieldValue>; after?: Record<string, FieldValue>;
}

export interface StoreFeatures { aggregate: boolean; search: boolean; changes: boolean; cursor_paging: true }
export interface StoreHealth { ok: boolean; detail?: string; checked_at: number }
export interface StoreVersion { store: string; version: string; conformance?: number }
export interface ExportChunk { seq: number; records: readonly StoredRecord[]; done: boolean; checksum: string }

export type StoreErrorCode =
  | "not_found" | "version_conflict" | "invalid" | "unknown_type" | "unknown_field" | "unsupported" | "unavailable" | "id_mismatch" | "sealed_value_refused" | "unique_violation";

/** What a store throws. `version_conflict` is what HTTP, MCP and outside-actor callers see when they write back a row that moved. */
export class StoreError extends Error {
  code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) { super(message); this.name = "StoreError"; this.code = code; }
}

export interface Store {
  define(diff: DefineDiff): Promise<DefineResult>;
  types(): Promise<readonly TypeDef[]>;
  describe(type: string): Promise<{ name: string; fields: { name: string; kind: string }[] } | null>;
  get(type: string, id: RecordId, opts?: { include_deleted?: boolean }): Promise<StoredRecord | null>;
  query(type: string, spec: QuerySpec): Promise<Page<StoredRecord>>;
  aggregate(type: string, spec: AggregateSpec): Promise<AggregateRow[]>;
  create(type: string, id: RecordId, data: Readonly<Record<string, FieldValue>>): Promise<StoredRecord>;
  update(type: string, id: RecordId, patch: Readonly<Record<string, FieldValue>>, base_version: number): Promise<StoredRecord>;
  remove(type: string, id: RecordId, base_version: number): Promise<StoredRecord>;
  restore(type: string, id: RecordId): Promise<StoredRecord>;
  search(spec: SearchSpec): Promise<Page<SearchHit>>;
  changes(since: string | null, limit: number): Promise<{ entries: ChangeEntry[]; cursor: string }>;
  health(): Promise<StoreHealth>;
  version(): Promise<StoreVersion>;
  export(since?: string): AsyncIterable<ExportChunk>;
  features(): StoreFeatures;
}
