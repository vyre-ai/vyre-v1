// Records > sync: the calls behind the screens. Polled over the capability door (the Sync page and the record page ask a few seconds apart while they are open); a push that a person starts
// by editing a field is nudged with one connectors.sync_now and watched for a few seconds, so the field goes saving, then saved, without a reload.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordSync, SyncedRow } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;

/** A value asked for now and again every `ms` (0: once, and when `refresh` is called). Failures keep the last value. */
export function usePolled<T>(load: () => Promise<T>, key: string, ms: number): { value: T | undefined; refresh(): void } {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    const run = (): void => { loadRef.current().then((v) => { if (live) setValue(v); }, () => undefined); };
    run();
    const timer = ms > 0 ? setInterval(run, ms) : undefined;
    // a timer must never keep a test process alive
    (timer as { unref?: () => void } | undefined)?.unref?.();
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [key, tick, ms]);
  return { value, refresh: useCallback(() => setTick((n) => n + 1), []) };
}

/** The synced types of the Space by record type. Empty until the first answer, and when the Space has none. */
export function useSyncedTypes(call: Call | undefined): Map<string, SyncedRow> {
  const { value } = usePolled(async () => (call ? ((await call("sync_types.list", {})) as { syncedTypes?: SyncedRow[] }).syncedTypes ?? [] : []), "synced-types", call ? 20_000 : 0);
  return new Map((value ?? []).map((r) => [r.type, r]));
}

export interface RecordSyncHandle { sync: RecordSync | undefined; refresh(): void; /** Call after a field was saved here: starts a pass and watches the field go out. */ touch(): void }

/** `enabled` is whether the record type is synced at all (the page knows it from the type): an ordinary record asks the server nothing. */
export function useRecordSync(call: Call, type: string, recordId: string, enabled = true): RecordSyncHandle {
  const { value, refresh } = usePolled(async () => (enabled ? ((await call("sync_types.record_state", { type, recordId })) as RecordSync) : undefined), `${type}:${recordId}:${enabled}`, 0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  const touch = useCallback((): void => {
    if (!value?.synced) return;
    void call("connectors.sync_now", { type, mode: "incremental", idempotencyKey: `edit:${type}:${recordId}:${Date.now()}` }).catch(() => undefined);
    for (const t of timers.current) clearTimeout(t);
    timers.current = [600, 2500, 7000, 15_000].map((ms) => { const t = setTimeout(refresh, ms); (t as { unref?: () => void }).unref?.(); return t; });
    refresh();
  }, [call, type, recordId, value?.synced, refresh]);
  return { sync: value, refresh, touch };
}
