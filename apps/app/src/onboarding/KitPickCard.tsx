// "Your organisation": the Space's name (the preview beside it follows each key) and, when this Space has Kits installed on purpose, which one fits its kind of work, as a quiet
// list with Start blank first. Sample and demo Kits are never offered (kit-pick.ts offeredKits). Continue saves the name and the pick.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TextField } from "../../../../ui/src/TextField/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import type { CapCall } from "../shell/session/caps.ts";
import { installKit, listKits, sheetFor, sheetLine } from "./kit-pick.ts";
import type { KitRow, KitSheet } from "./kit-pick.ts";
import { CARD } from "./card-style.ts";

function Radio({ on }: { on: boolean }): ReactElement {
  return <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>;
}

export function KitPickCard({ call, spaceName = "", onName, onInstalled, gate }: { call: CapCall; spaceName?: string; onName?(name: string): void; onInstalled(kitId: string): void; gate?(save: (() => Promise<boolean>) | null, label?: string): void }): ReactElement {
  const [name, setName] = useState(spaceName);
  const [kits, setKits] = useState<KitRow[] | null>(null);
  const [picked, setPicked] = useState<KitRow | null>(null);
  const [sheet, setSheet] = useState<KitSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let off = false; void listKits(call).then((k) => { if (!off) setKits(k); }).catch(() => { if (!off) setKits([]); }); return () => { off = true; }; }, [call]);
  const typed = (v: string): void => { setName(v); onName?.(v); };
  const pick = async (k: KitRow | null): Promise<void> => {
    setPicked(k); setSheet(null); setError("");
    if (!k) return;
    try { setSheet(await sheetFor(call, k.kitId)); } catch { setError("Could not read this Kit."); }
  };
  // Continue saves: the name, then the Kit when one is picked; Start blank installs nothing.
  const save = async (): Promise<boolean> => {
    if (busy || name.trim() === "") return false;
    setBusy(true); setError("");
    try {
      if (name.trim() !== spaceName) await call("spaces.update", { name: name.trim(), logoFileId: null });
      if (picked && !picked.installed) await installKit(call, picked.kitId);
      else if (picked) await call("kits.choose", { kitId: picked.kitId, scope: "space" });
      return true;
    } catch { setError("Could not save. Try again."); return false; } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!gate) return undefined;
    gate(name.trim() === "" ? null : save);
    return () => gate(null);
  });
  const rows: ReactElement[] = [];
  rows.push(<Row key="blank" id="kit-blank" title="Start blank" note="Add what you need as you go" selected={picked === null} leading={<Radio on={picked === null} />} onPress={() => void pick(null)} domProps={{ role: "radio", "aria-checked": picked === null }} />);
  for (const k of kits ?? []) {
    const on = picked?.kitId === k.kitId;
    rows.push(<Row key={k.kitId} id={`kit-${k.kitId}`} title={k.title} {...(k.installed ? { note: "Installed" } : {})} selected={on} leading={<Radio on={on} />} onPress={() => void pick(k)} domProps={{ role: "radio", "aria-checked": on }} />);
  }
  return (
    <View testID="kit-pick" style={s.col}>
      <TextField testID="org-name" accessibilityLabel="Name of your Space" value={name} onChangeText={typed} placeholder="Name of your Space" autoCorrect={false} />
      {(kits ?? []).length > 0 ? (
        <>
          <Text style={s.dim}>Kind of work</Text>
          <View testID="kit-list" accessibilityRole="radiogroup" style={s.list}>{rows}</View>
        </>
      ) : null}
      {sheet && picked ? <Text testID="kit-sheet" style={s.dim}>{sheetLine(sheet)}</Text> : null}
      {error ? <Text testID="kit-error" style={s.err}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  list: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, padding: 4, backgroundColor: "var(--win)" as string },
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  err: CARD.err,
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", marginRight: 10 },
  radioOn: { borderColor: "var(--accent)" as string },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--accent)" as string },
});
