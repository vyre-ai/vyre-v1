import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useAppsData } from "./data.tsx";
import { errorMessage } from "./mutations.ts";
import type { AppsRoute } from "./routes.ts";
const ONLINE = { get: () => "online" as const, subscribe: () => () => undefined };
export function useOnline(): boolean { const d = useAppsData(), c = d.connection ?? ONLINE; return useSyncExternalStore(c.subscribe, c.get, c.get) === "online"; }
export function useRead<T>(cap: string | null, input: object, group: AppsRoute["group"] = "forms") {
  const d = useAppsData(), key = JSON.stringify(input);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<T | null>(() => cap ? d.peek?.(cap, input) as T ?? null : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cap !== null && data === null);
  const read = useMemo(() => ({ cap, key }), [cap, key]);
  useEffect(() => { if (!read.cap) return; let live = true; setLoading(true); setError(null); void d.call(read.cap, JSON.parse(read.key)).then((out) => { if (live) { setData(out as T); setLoading(false); } }).catch((e) => { if (live) { setError(errorMessage(e)); setLoading(false); } }); return () => { live = false; }; }, [d, read, revision]);
  useEffect(() => {
    if (!cap) return;
    // Live list invalidation refreshes the selected object too. A read does not invalidate its list.
    const screen = group === "domains" ? "mail.domains" : `apps.${group}`;
    const name = group === "domains" ? "domains" : group;
    try { return d.screens.query(screen, name, {}).subscribe(() => setRevision((n) => n + 1)); } catch { return undefined; }
  }, [d, cap, group]);
  return { data, error, loading, refresh: () => setRevision((n) => n + 1) };
}
export function Button({ title, onPress, disabled, testID, primary }: { title: string; onPress(): void; disabled?: boolean; testID?: string; primary?: boolean }): ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID} style={[s.button, primary && s.primary, disabled && { opacity: 0.45 }]}><Text style={[s.buttonText, primary && { color: "var(--accent-ink)" as string }]}>{title}</Text></Pressable>;
}
export function Field({ label, value, onChange, multiline = false, disabled = false, placeholder }: { label: string; value: string; onChange(value: string): void; multiline?: boolean; disabled?: boolean; placeholder?: string }): ReactElement {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} editable={!disabled} placeholder={placeholder} style={[s.input, multiline && { minHeight: 100, textAlignVertical: "top" }]} /></View>;
}
export function Select({ label, value, options, onChange, disabled, compact }: { compact?: boolean; label: string; value: string; options: readonly { key: string; title: string }[]; onChange(value: string): void; disabled?: boolean }): ReactElement {
  const { element, show } = useMenu();
  return <View style={s.field}>{compact ? null : <Text style={s.label}>{label}</Text>}<Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} style={[s.button, compact && { minHeight: 26, paddingVertical: 3, paddingHorizontal: 6, borderWidth: 0 }]} onPress={(event) => {
    event.stopPropagation();
    const e = event as unknown as { currentTarget?: { getBoundingClientRect?(): { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
    const rect = e.currentTarget?.getBoundingClientRect?.();
    show(options.map((o) => ({ label: o.title, onSelect: () => onChange(o.key) })), rect?.left ?? e.nativeEvent?.pageX ?? 20, rect?.bottom ?? e.nativeEvent?.pageY ?? 100, "other");
  }}><Text style={s.buttonText}>{options.find((o) => o.key === value)?.title ?? (value || "Choose…")}</Text></Pressable>{element}</View>;
}
export function Frame({ title, children, error, loading, retry, back, offline, testID = "apps-editor" }: { title: string; children: ReactNode; testID?: string; error?: string | null; loading?: boolean; retry?(): void; back(): void; offline?: boolean }): ReactElement {
  return <View style={s.page} testID={testID}><View style={s.head}><Button title="Back to Apps" onPress={back} /><Text accessibilityRole="header" style={s.heading}>{title}</Text></View><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><View style={s.column}>
    {offline ? <States kind="offline" title="Reconnect to this Space to save or send." /> : null}
    {error ? <States kind="error" message={error} {...(retry ? { onRetry: retry } : {})} /> : null}
    {loading ? <Text>Loading…</Text> : children}
  </View></ScrollView></View>;
}
export function Card({ title, children }: { title: string; children: ReactNode }): ReactElement { return <View style={s.card}><Text accessibilityRole="header" style={s.cardTitle}>{title}</Text>{children}</View>; }
export const s = StyleSheet.create({ page: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string }, head: { flexDirection: "row", alignItems: "center", gap: 18, minHeight: 54, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: "var(--line)" as string }, heading: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string }, content: { padding: 24, alignItems: "center" }, column: { width: "100%", maxWidth: 980, gap: 18 }, card: { borderBottomWidth: 1, borderColor: "var(--line)" as string, borderRadius: 0, backgroundColor: "transparent", padding: 16, gap: 12 }, cardTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string }, field: { gap: 7 }, label: { fontSize: 12, color: "var(--ink-3)" as string }, input: { minHeight: 36, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 6, padding: 9, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string }, button: { alignSelf: "flex-start", minHeight: 32, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: "var(--line)" as string }, primary: { backgroundColor: "var(--accent)" as string }, buttonText: { fontSize: 12.5, color: "var(--ink)" as string }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, text: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 20 } });
