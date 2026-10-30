import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { installKit, listKits, sheetFor, sheetLine } from "./kit-pick.ts";
import type { KitRow, KitSheet } from "./kit-pick.ts";

export function KitPickCard({ call, onInstalled }: { call: CapCall; onInstalled(kitId: string): void }): ReactElement {
  const [kits, setKits] = useState<KitRow[] | null>(null);
  const [picked, setPicked] = useState<KitRow | null>(null);
  const [sheet, setSheet] = useState<KitSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let off = false; void listKits(call).then((k) => { if (!off) setKits(k); }).catch(() => { if (!off) setError("Could not load the Kits."); }); return () => { off = true; }; }, [call]);
  const pick = async (k: KitRow): Promise<void> => {
    setPicked(k); setSheet(null); setError("");
    try { setSheet(await sheetFor(call, k.kitId)); } catch { setError("Could not read this Kit."); }
  };
  const install = async (): Promise<void> => {
    if (!picked || busy) return;
    setBusy(true); setError("");
    try { await installKit(call, picked.kitId); onInstalled(picked.kitId); } catch { setError("Could not install this Kit."); } finally { setBusy(false); }
  };
  return (
    <View testID="kit-pick" style={s.col}>
      <Text style={s.line}>Pick the Kit for your kind of work.</Text>
      {kits === null && !error ? <Text style={s.dim}>Loading Kits</Text> : null}
      {/* ui-rows-lint: not a list (Kit choices are tiles, not list rows) */}
      <View style={s.row}>{(kits ?? []).map((k) => (
        <Pressable key={k.kitId} testID={`kit-${k.kitId}`} accessibilityRole="button" accessibilityState={{ selected: picked?.kitId === k.kitId }} onPress={() => void pick(k)} style={[s.tile, picked?.kitId === k.kitId && s.tileOn]}><Text style={s.tileText}>{k.installed ? `${k.title} (installed)` : k.title}</Text></Pressable>
      ))}</View>
      {sheet ? <Text testID="kit-sheet" style={s.dim}>{sheetLine(sheet)}</Text> : null}
      {error ? <Text testID="kit-error" style={s.err}>{error}</Text> : null}
      {picked && sheet ? <Pressable testID="kit-install" accessibilityRole="button" disabled={busy || sheet.problems > 0} onPress={() => void install()} style={[s.primary, (busy || sheet.problems > 0) && s.off]}><Text style={s.primaryText}>{busy ? "Installing" : `Install ${picked.title}`}</Text></Pressable> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  line: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger, #c0392b)" as string },
  tile: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", backgroundColor: "var(--win)" as string },
  tileOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  tileText: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  off: { opacity: 0.45 },
});
