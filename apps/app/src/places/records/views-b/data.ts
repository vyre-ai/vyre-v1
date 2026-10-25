// What the views of part B read: the records of the view (the first thousand that match its filter) and the cached count of all of them.
import { useRef } from "react";
import { useLive } from "../sidebar/data.tsx";
import { countSpec } from "../table/model.ts";
import { pageSpec } from "../views-a/model.ts";
import type { TableViewState } from "../views-a/model.ts";
import type { RecordRow } from "./model.ts";
import { VIEW_LIMIT } from "./model.ts";

export function useViewRows(type: string, v: TableViewState, titleField: string): { rows: readonly RecordRow[]; count: number; ready: boolean } {
  const q = useLive("records.query", pageSpec(type, v, titleField, VIEW_LIMIT));
  const n = useLive("records.counts", countSpec(type, v, titleField));
  const kept = useRef<RecordRow[]>([]);
  if (q.status === "ready") kept.current = q.data.rows;
  return { rows: kept.current, count: n.status === "ready" ? n.data.count : kept.current.length, ready: q.status === "ready" };
}
