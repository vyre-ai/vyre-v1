import type { Change, LocalDb } from "../store/index.ts";

export type QueryState<T> = { status: "loading" } | { status: "ready"; data: T };
/** The shape useSyncExternalStore wants. getSnapshot returns the same object until a change affects the query. */
export interface LiveQuery<T> { subscribe(listener: () => void): () => void; getSnapshot(): QueryState<T> }

/** A query answered by one local SQL read. `entities` are the replica entities it reads; a change to any other entity never touches it. */
export interface QueryDef<I, O> {
  cap: string;
  entities: readonly string[];
  run(db: LocalDb, input: I): O;
  /** Return false when this change cannot alter the result for this input. Absent: every change to a listed entity does. */
  affects?(change: Change, input: I): boolean;
}

/** A long list: ids come from one index-only read, rows are read for the window on screen and cached. */
export interface ListDef<I, R> {
  cap: string;
  entity: string;
  orderIds(db: LocalDb, input: I): readonly string[];
  /** Rows for these ids, any order. Missing ids are simply absent. */
  readRows(db: LocalDb, ids: readonly string[]): R[];
  idOf(row: R): string;
  /** Does the row belong in this list? Absent: any change to an unknown id re-reads the ids. */
  matches?(row: R, input: I): boolean;
  /** The part of a row that decides its position. Absent: any change to a listed row re-reads the ids. */
  orderKey?(row: R): unknown;
}

export interface ListWindow<R> {
  readonly version: number;
  readonly count: number;
  readonly ids: readonly string[];
  /** Rows for positions [start, end). Reads only the ones not cached. Same object for an unchanged row. */
  rows(start: number, end: number): (R | undefined)[];
  row(id: string): R | undefined;
}
