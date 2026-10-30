import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import type { CapCall } from "../shell/session/caps.ts";
import { installKit, listKits, sheetFor, sheetLine } from "./kit-pick.ts";
import type { KitRow, KitSheet } from "./kit-pick.ts";

export function KitPickCard({ call, spaceName = "", onInstalled }: { call: CapCall; spaceName?: string; onInstalled(kitId: string): void }): ReactElement {
  const [name, setName] = useState(spaceName);
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
  // Save names the Space, then installs the Kit when one is picked; "Start blank" installs nothing.
  const save = async (): Promise<void> => {
    if (busy || name.trim() === "") return;
    setBusy(true); setError("");
    try {
      if (name.trim() !== spaceName) await call("spaces.update", { name: name.trim(), logoFileId: null });
      if (picked) await installKit(call, picked.kitId);
      onInstalled(picked?.kitId ?? "");
    } catch { setError("Could not save. Try again."); } finally { setBusy(false); }
  };
  const chips: ReactElement[] = [];
  chips.push(<Pressable key="blank" testID="kit-blank" accessibilityRole="button" accessibilityState={{ selected: picked === null }} onPress={() => { setPicked(null); setSheet(null); }} style={[s.tile, picked === null && s.tileOn]}><Text style={s.tileText}>Start blank</Text></Pressable>);
  for (const k of kits ?? []) {
    chips.push(<Pressable key={k.kitId} testID={`kit-${k.kitId}`} accessibilityRole="button" accessibilityState={{ selected: picked?.kitId === k.kitId }} onPress={() => void pick(k)} style={[s.tile, picked?.kitId === k.kitId && s.tileOn]}><Text style={s.tileText}>{k.installed ? `${k.title} (installed)` : k.title}</Text></Pressable>);
  }
  return (
    <View testID="kit-pick" style={s.col}>
      <TextField testID="org-name" accessibilityLabel="Name" value={name} onChangeText={setName} placeholder="Name" autoCorrect={false} />
      <Text style={s.dim}>Kind of work</Text>
      <View style={s.row}>{chips}</View>
      {sheet && picked ? <Text testID="kit-sheet" style={s.dim}>{sheetLine(sheet)}</Text> : null}
      {error ? <Text testID="kit-error" style={s.err}>{error}</Text> : null}
      <Pressable testID="kit-install" accessibilityRole="button" disabled={busy || name.trim() === "" || (sheet?.problems ?? 0) > 0} onPress={() => void save()} style={[s.primary, (busy || name.trim() === "" || (sheet?.problems ?? 0) > 0) && s.off]}><Text style={s.primaryText}>{busy ? "Saving" : "Save"}</Text></Pressable>
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
