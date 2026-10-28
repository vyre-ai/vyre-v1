import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { States } from "../../../../../ui/src/States/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import { useConsoleData } from "../shell/data.tsx";

export function useRead<T>(cap: string, input: Record<string, unknown> = {}) {
  const { call, screens } = useConsoleData();
  const key = JSON.stringify(input);
  const query = useMemo(() => (screens as { capQuery?: (cap: string, input: Record<string, unknown>) => LiveQuery<T> }).capQuery?.(cap, JSON.parse(key)), [screens, cap, key]);
  const never = useMemo<LiveQuery<T>>(() => { const loading: QueryState<T> = { status: "loading" }; return { subscribe: () => () => undefined, getSnapshot: () => loading }; }, []);
  const snapshot = useSyncExternalStore((query ?? never).subscribe, (query ?? never).getSnapshot, (query ?? never).getSnapshot);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const refresh = useCallback(() => { (screens as { invalidate?: () => void }).invalidate?.(); setRevision((n) => n + 1); }, [screens]);
  useEffect(() => {
    if (query) return;
    let alive = true;
    void call(cap, JSON.parse(key)).then((data) => { if (alive) setState({ data: data as T }); }, () => { if (alive) setState({ error: "Couldn’t load this page. Check access and try again." }); });
    return () => { alive = false; };
  }, [call, cap, key, revision, query]);
  return query ? { data: snapshot.status === "ready" ? snapshot.data : undefined, error: snapshot.status === "loading" && snapshot.error ? "Couldn’t load this page. Check access and try again." : undefined, refresh } : { ...state, refresh };
}
export function useAction(refresh: () => void) {
  const { call } = useConsoleData();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const run = async <T,>(cap: string, input: unknown, success: string | ((out: T) => string)): Promise<T | undefined> => {
    if (inflight.current) return undefined;
    inflight.current = true; setBusy(true); setNote("");
    try { const out = await call(cap, input); setNote(typeof success === "function" ? success(out as T) : success); refresh(); return out as T; }
    catch (e) { const error = e as { code?: string; traceId?: string }; setNote(`Couldn’t complete this action${error.code ? ` (${error.code})` : ""}.${error.traceId ? ` Trace ${error.traceId}` : ""}`); return undefined; }
    finally { inflight.current = false; setBusy(false); }
  };
  return { note, busy, run };
}
export function Field({ label, value, onChange, testID, secure = false, multiline = false }: { label: string; value: string; onChange: (value: string) => void; testID?: string; secure?: boolean; multiline?: boolean }): ReactElement {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput multiline={multiline} value={value} onChangeText={onChange} accessibilityLabel={label} testID={testID} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} style={s.input} /></View>;
}
export function Button({ label, onPress, disabled = false, testID, danger = false }: { label: string; onPress: () => void; disabled?: boolean; testID?: string; danger?: boolean }): ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} testID={testID} style={[s.button, disabled && { opacity: 0.5 }]}><Text style={[s.buttonText, danger && { color: "var(--danger)" as string }]}>{label}</Text></Pressable>;
}
export function Actions({ children }: { children: ReactNode }): ReactElement { return <View style={s.actions}>{children}</View>; }
export function Note({ children }: { children: ReactNode }): ReactElement { return <Text accessibilityRole="status" style={s.note}>{children}</Text>; }
export function ReadState({ error, retry }: { error?: string | undefined; retry: () => void }): ReactElement { return error ? <States kind="error" message={error} retryable onRetry={retry} /> : <Text accessibilityRole="progressbar">Loading…</Text>; }
export const attempt = (): string => globalThis.crypto.randomUUID();
const s = StyleSheet.create({ field: { gap: 6, marginVertical: 8 }, label: { fontSize: 12, color: "var(--ink-3)" as string }, input: { height: 34, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, paddingHorizontal: 10, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginVertical: 10 }, button: { paddingHorizontal: 12, height: 32, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, backgroundColor: "var(--raised)" as string }, buttonText: { color: "var(--ink)" as string, fontSize: 13 }, note: { fontSize: 13, color: "var(--ink-2)" as string, marginVertical: 8 } });
