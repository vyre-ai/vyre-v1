// What the review surfaces need from the shell: live queries over the kept copy, the capability door, who is who, where a click goes. The shell fills this in; the screenshot mount and the tests pass their own.
import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";

/** The capabilities the review surfaces read live (the queries of screens files.changeset-header, files.diff, files.commit-diff, files.git-row, files.history and files.lint-bar). */
export type ReviewCap =
  | "changesets.get" | "changesets.diff" | "changesets.comments.list"
  | "git.status" | "git.list_branches" | "git.log" | "git.show"
  | "files.versions" | "files.diff" | "files.lint" | "agents.suggestions.list";

/** Where a click goes. The shell decides how a diff tab or a conflict opens. */
export interface ReviewNav {
  /** Review changes: the diff tab of a changeset. */
  openChangeset(changesetId: string): void;
  /** Compare two versions of a file: a diff tab. */
  compare(fileId: string, from: string, to: string): void;
  /** A commit in the diff tab. */
  openCommit(folderId: string, sha: string): void;
  /** The changeset left the review (approved, discarded or sent back). */
  settled(changesetId: string, state: "approved" | "discarded" | "changes_requested"): void;
  /** The file's History tab (the clock icon of the file header). */
  openHistory?(fileId: string): void;
  /** Find in the file (the magnifier of the file header). */
  findInFile?(fileId: string): void;
  /** Ask control: start a thread with this agent about the file. */
  ask?(agentId: string, mode: "chat" | "do", about: { kind: string; id: string; title: string }): void;
}

export interface ReviewData {
  /** A live query for a capability and input over the kept copy. */
  live<C extends ReviewCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** The name to show for a person or agent id. */
  nameOf(id: string): string;
  /** A fresh idempotency key for one attempt. */
  key(): string;
  /** Now, for "2 minutes ago" lines. */
  clock(): { now: number };
  /** Agents a changeset can be sent to for an outside review, id and name. */
  reviewers?: readonly { id: string; name: string }[];
  /** Every agent the person can ask (the Ask control of the file header), assistant included. */
  agents?: readonly { id: string; name: string; role?: string; assistant?: boolean }[];
  /** The people of the Space, id and name: the Owner pick of agent.toml's Form view. Missing, the pick offers the current owner only. */
  people?: readonly { id: string; name: string }[];
  nav: ReviewNav;
}

const Ctx = createContext<ReviewData | null>(null);

export type ReviewLayout = "unified" | "split";
const LayoutCtx = createContext<{ layout: ReviewLayout; set(l: ReviewLayout): void }>({ layout: "unified", set: () => undefined });

/** The layout of the open diff (Unified or Split): the page header's switch writes it, the diff reads it. One per provider, so the header and the diff agree wherever the shell puts them. */
export function useReviewLayout(): [ReviewLayout, (l: ReviewLayout) => void] {
  const v = useContext(LayoutCtx);
  return [v.layout, v.set];
}

export function ReviewDataProvider({ value, children }: { value: ReviewData; children: ReactNode }): ReactElement {
  const [layout, set] = useState<ReviewLayout>("unified");
  const lv = useMemo(() => ({ layout, set }), [layout]);
  return <Ctx.Provider value={value}><LayoutCtx.Provider value={lv}>{children}</LayoutCtx.Provider></Ctx.Provider>;
}

export function useReviewData(): ReviewData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The review surfaces need a ReviewDataProvider above them");
  return v;
}

const LOADING: QueryState<never> = { status: "loading" };
const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => LOADING };

/** A live capability query. The input is compared by value; `enabled` false keeps it loading and asks nothing. */
export function useCap<C extends ReviewCap>(cap: C, input: CapMap[C]["in"], enabled = true): QueryState<CapMap[C]["out"]> {
  const { live } = useReviewData();
  const key = JSON.stringify(input);
  const q = useMemo(() => (enabled ? live(cap, JSON.parse(key) as CapMap[C]["in"]) : (NEVER as LiveQuery<CapMap[C]["out"]>)), [live, cap, key, enabled]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export interface Many<T> { ready: boolean; items: readonly (T | undefined)[] }

/** The same capability for several inputs at once (one diff per file of a changeset). Ready when every one has answered. */
export function useCapMany<C extends ReviewCap>(cap: C, inputs: readonly CapMap[C]["in"][]): Many<CapMap[C]["out"]> {
  const { live } = useReviewData();
  const key = JSON.stringify(inputs);
  const queries = useMemo(() => (JSON.parse(key) as CapMap[C]["in"][]).map((i) => live(cap, i)), [live, cap, key]);
  const last = useRef<{ queries: unknown; snaps: readonly QueryState<CapMap[C]["out"]>[]; value: Many<CapMap[C]["out"]> } | null>(null);
  const subscribe = useCallback((l: () => void) => {
    const offs = queries.map((q) => q.subscribe(l));
    return () => { for (const off of offs) off(); };
  }, [queries]);
  const snapshot = useCallback((): Many<CapMap[C]["out"]> => {
    const snaps = queries.map((q) => q.getSnapshot());
    const prev = last.current;
    if (prev && prev.queries === queries && prev.snaps.length === snaps.length && snaps.every((s, i) => s === prev.snaps[i])) return prev.value;
    const value: Many<CapMap[C]["out"]> = { ready: snaps.every((s) => s.status === "ready"), items: snaps.map((s) => (s.status === "ready" ? s.data : undefined)) };
    last.current = { queries, snaps, value };
    return value;
  }, [queries]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
