// A resolver answers one read capability from the local replica (ARCH 9, spec 603-604): the same output the capability returns, built from synced tables with SQL, so a place paints with
// no network. A resolver that cannot answer an input from what the device keeps returns MISS and the shell asks the gateway for that query instead.
import type { Change, LocalDb } from "../space.ts";

/** What a resolver needs to know about the signed-in session. */
export interface ResolverCtx {
  spaceId: string;
  /** The signed-in person's id (usr_...). */
  person: string;
}

export const MISS = Symbol("replica-miss");
export type Miss = typeof MISS;

export interface Resolver<I = never, O = unknown> {
  cap: string;
  /** The replica entities it reads: a change to any other entity never wakes it. */
  entities: readonly string[];
  run(db: LocalDb, input: I, ctx: ResolverCtx): O | Miss;
  /** Return false when this change cannot alter the answer for this input. Absent: every change to a listed entity does. */
  affects?(change: Change, input: I): boolean;
}

export const resolver = <I, O>(r: Resolver<I, O>): Resolver => r as unknown as Resolver;
