// What the open type says about sharing: the viewer's rights on it, which rows differ from it, and what "Shared with me" keeps. Read live, so a change shows without a refresh.
import { useMemo, useSyncExternalStore } from "react";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import { useOptionalRecordsData } from "../sidebar/data.tsx";
import { NO_RIGHTS, hasShared, marksOf, sharedWithMe } from "./model.ts";
import type { MarksOut, RowMark, Rights, SharesOut } from "./model.ts";

export interface RecordAccess {
  /** A Team Space with a Share sheet. False in a Personal Space: nothing about sharing is drawn. */
  on: boolean;
  can: Rights;
  marks: ReadonlyMap<string, RowMark>;
  /** Is there a "Shared with me" to offer? */
  hasShared: boolean;
  /** The ids it keeps; null keeps every row. */
  sharedIds: readonly string[] | null;
}

const OFF: RecordAccess = { on: false, can: NO_RIGHTS, marks: new Map(), hasShared: false, sharedIds: null };
const WAITING: QueryState<never> = { status: "loading" };
const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => WAITING };

export function useRecordAccess(type: string): RecordAccess {
  const data = useOptionalRecordsData();
  const on = data?.share !== undefined;
  // a Personal Space never asks: there is nobody to share with
  const q = useMemo(() => (data && on ? data.live("access.record_marks", { type }) : NEVER) as LiveQuery<MarksOut>, [data, on, type]);
  const state = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const out = state.status === "ready" ? state.data : null;
  return useMemo(() => (!on ? OFF : { on, can: out?.can ?? NO_RIGHTS, marks: marksOf(out), hasShared: hasShared(out), sharedIds: sharedWithMe(out) }), [on, out]);
}

/** The viewer's rights on one record, for the Share button on its page. Read live; a Personal Space never asks. */
export function useRecordRights(recordId: string): { on: boolean; can: Rights } {
  const data = useOptionalRecordsData();
  const on = data?.share !== undefined;
  const q = useMemo(() => (data && on ? data.live("access.shares_of", { resource: { type: "record", id: recordId } }) : NEVER) as LiveQuery<SharesOut>, [data, on, recordId]);
  const state = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const can = state.status === "ready" ? state.data.can ?? NO_RIGHTS : NO_RIGHTS;
  return useMemo(() => ({ on, can }), [on, can]);
}
