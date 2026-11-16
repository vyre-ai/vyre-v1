// The signature requests of a file or a record, read live: once on open, then every few seconds while one is waiting, so the status turns to Signed on its own.
import { useCallback, useEffect, useRef, useState } from "react";
import { readRequest, requestsOf } from "./actions.ts";
import { changeWords, current, isOpen } from "./model.ts";
import type { Envelope } from "./model.ts";
import type { SignData } from "./data.tsx";

const POLL_MS = 4000;

export function useRequests(
  d: SignData | null,
  key: { fileId?: string; recordId?: string },
  rev = 0,
  /** Say, in the top bar, when the request being watched finishes (the file's viewer; a record's list stays quiet). */
  announce = false,
): { list: Envelope[]; now: Envelope | null; loaded: boolean; reload(): void } {
  const [list, setList] = useState<Envelope[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const seen = useRef<Envelope | null>(null);
  const k = `${key.fileId ?? ""}|${key.recordId ?? ""}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!d || (!key.fileId && !key.recordId)) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async (): Promise<void> => {
      let rows: Envelope[] = [];
      try {
        rows = await requestsOf(d.call, key);
        // the list rows carry no signers: read the open one for who is still to sign
        const open = current(rows);
        if (open && open.signers.length === 0) {
          const full = await readRequest(d.call, open.id);
          if (full)
            rows = rows.map((r) => (r.id === open.id ? { ...r, ...full, title: r.title, state: full.state } : r));
        }
      } catch {
        rows = [];
      }
      if (!live) return;
      if (announce) {
        const said = changeWords(seen.current, current(rows));
        if (said) d.say?.(said);
        seen.current = current(rows);
      }
      setList(rows);
      setLoaded(true);
      const open = current(rows);
      if (open && isOpen(open)) timer = setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, k, rev, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { list, now: current(list), loaded, reload };
}
