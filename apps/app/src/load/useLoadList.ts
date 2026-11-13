// The list hook (contract P3): a long list that pages by cursor and stays live. Page 1 is a watched read (re-read on every change batch); later pages are fetched by the cursor the
// capability returns (`next`), deduped by id, one request per page and none per row. The foot of the list says "Loading more" or "Couldn't load more. Retry" through `more`, and never
// replaces the rows. Every list capability already takes `cursor` and `limit` and answers `next` and `total` (manifests/_common.ts pageIn and pageOut).
//   rows        the key of the answer that holds the rows (default "rows")
//   pageSize    rows per request (default 50)
// Not yet built, said plainly: reading backwards from a newest item (`loadEarlier`, for a feed that opens at its end: P4) and dropping pages far from the window (`keepPages`).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Load } from "../../../../ui/src/States/Loadable.tsx";
import type { LoadFailure } from "../../../../ui/src/States/Loads.tsx";
import { failureFrom } from "./failure.ts";
import { useCapCall } from "./call.tsx";
import { useLoad } from "./useLoad.ts";

export type MoreState = "idle" | "loading" | { failed: LoadFailure; retry(): void };
export interface LoadList<R> {
  load: Load<{ rows: readonly R[]; total?: number }>;
  hasMore: boolean;
  loadMore(): void;
  more: MoreState;
}
export interface LoadListSource<R> {
  cap: string;
  input?: Record<string, unknown>;
  idOf(row: R): string;
  rows?: string;
}
interface Page<R> {
  rows: readonly R[];
  next?: string | undefined;
  total?: number | undefined;
}

const pageOf = <R>(out: unknown, key: string): Page<R> => {
  const o = (out ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o[key]) ? (o[key] as R[]) : [];
  return {
    rows,
    next: typeof o["next"] === "string" && o["next"] !== "" ? o["next"] : undefined,
    total: typeof o["total"] === "number" ? o["total"] : undefined,
  };
};

export function useLoadList<R>(src: LoadListSource<R>, o: { pageSize?: number } = {}): LoadList<R> {
  const call = useCapCall();
  const pageSize = o.pageSize ?? 50;
  const key = src.rows ?? "rows";
  const inputKey = JSON.stringify(src.input ?? {});
  const first = useLoad<Record<string, unknown>>({
    cap: src.cap,
    input: { ...(JSON.parse(inputKey) as object), limit: pageSize },
  });
  // later pages, by the cursor of the one before; they belong to one input and are dropped when it changes
  const [later, setLater] = useState<{ at: string; pages: readonly Page<R>[] }>({ at: inputKey, pages: [] });
  const [more, setMore] = useState<MoreState>("idle");
  const asking = useRef(false);
  const epoch = useRef(0);
  const pages = later.at === inputKey ? later.pages : [];
  useEffect(() => {
    epoch.current++;
    asking.current = false;
    setMore("idle");
  }, [inputKey, src.cap]);

  const head = first.state === "ready" ? pageOf<R>(first.data, key) : null;
  const tail = pages.length > 0 ? pages[pages.length - 1]! : null;
  const cursor = tail ? tail.next : head?.next;

  const loadMore = useCallback((): void => {
    if (asking.current || cursor === undefined) return;
    asking.current = true;
    const mine = epoch.current;
    setMore("loading");
    void Promise.resolve(call(src.cap, { ...(JSON.parse(inputKey) as object), cursor, limit: pageSize })).then(
      (out) => {
        if (epoch.current !== mine) return;
        asking.current = false;
        setLater((was) => ({ at: inputKey, pages: [...(was.at === inputKey ? was.pages : []), pageOf<R>(out, key)] }));
        setMore("idle");
      },
      (e: unknown) => {
        if (epoch.current !== mine) return;
        asking.current = false;
        setMore({ failed: failureFrom(e), retry: () => loadMore() });
      },
    );
  }, [call, src.cap, inputKey, pageSize, cursor, key]);

  const load = useMemo((): Load<{ rows: readonly R[]; total?: number }> => {
    if (first.state !== "ready" || head === null) return first.state === "ready" ? { state: "loading" } : first;
    const seen = new Set<string>();
    const rows: R[] = [];
    for (const r of [...head.rows, ...pages.flatMap((p) => p.rows)]) {
      const id = src.idOf(r);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(r);
    }
    const total = (tail ?? head).total ?? head.total;
    return { state: "ready", data: { rows, ...(total !== undefined ? { total } : {}) } };
  }, [first, head, pages, tail, src]);

  return { load, hasMore: cursor !== undefined, loadMore, more };
}
