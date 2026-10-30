// The "Local folders" step on the desktop app: the system folder dialog (the shell's pick_paths), the picked folders as rows, and Continue mounts them through mounts.add, the call Files uses.
// The folders stay on this computer (live only). On the web and the phone the step keeps the card that opens Files.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { thisDevice, writableFolders } from "../shell/providers/files-mounts-data.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export const shellInvoke = (): Invoke | undefined => (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const parentOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).slice(-3, -1).join("/");

export function FoldersCard({ call, gate, invoke = shellInvoke() }: { call: CapCall; gate?(save: (() => Promise<boolean>) | null): void; invoke?: Invoke | undefined }): ReactElement {
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const where = useRef<{ into: string; deviceId: string } | null>(null);
  useEffect(() => {
    let off = false;
    void Promise.all([thisDevice(call), writableFolders(call).catch(() => [])]).then(([device, folders]) => {
      if (!off && device && folders[0]) where.current = { into: folders[0].id, deviceId: device.id };
    });
    return () => { off = true; };
  }, [call]);
  const pick = async (): Promise<void> => {
    if (!invoke || busy) return;
    setError("");
    try {
      const got = await invoke("pick_paths", { options: { title: "Choose a folder", multiple: false, directory: true, filters: [] } });
      const next = Array.isArray(got) ? got.filter((p): p is string => typeof p === "string") : [];
      setPaths((old) => { const all = [...old]; for (const p of next) if (!all.includes(p)) all.push(p); return all; });
    } catch { setError("Could not open the folder dialog."); }
  };
  const save = async (): Promise<boolean> => {
    if (busy || paths.length === 0) return false;
    const at = where.current ?? (await (async () => {
      const [device, folders] = await Promise.all([thisDevice(call), writableFolders(call).catch(() => [])]);
      return device && folders[0] ? { into: folders[0].id, deviceId: device.id } : null;
    })());
    if (!at) { setError("This computer is not ready to share folders yet. Try again in a moment."); return false; }
    where.current = at;
    setBusy(true); setError("");
    const left: string[] = [];
    for (const path of paths) {
      try {
        await call("mounts.add", { into: at.into, source: { kind: "local", deviceId: at.deviceId, localPath: path }, name: baseName(path), mode: "live_only", idempotencyKey: `mount:local:${path}:${at.into}` });
      } catch { left.push(path); }
    }
    setBusy(false);
    setPaths(left);
    if (left.length > 0) { setError(left.length === 1 ? `Could not add ${baseName(left[0]!)}. Try again.` : `Could not add ${left.length} folders. Try again.`); return false; }
    return true;
  };
  useEffect(() => {
    if (!gate) return undefined;
    gate(paths.length === 0 ? null : save);
    return () => gate(null);
  });
  const rows: ReactElement[] = [];
  paths.forEach((p, i) => {
    rows.push(
      <View key={p} testID={`folder-row-${i}`} style={s.row}>
        <Text style={s.name} numberOfLines={1}>{baseName(p)}</Text>
        <Text style={s.note} numberOfLines={1}>{parentOf(p)}</Text>
        <Pressable testID={`folder-remove-${i}`} accessibilityRole="button" accessibilityLabel={`Remove ${baseName(p)}`} onPress={() => setPaths((old) => old.filter((x) => x !== p))} style={s.x}><Text style={s.xText}>{"×"}</Text></Pressable>
      </View>,
    );
  });
  return (
    <View testID="folders-card" style={s.col}>
      {rows.length > 0 ? <View style={s.list}>{rows}</View> : null}
      {error ? <Text accessibilityRole="alert" testID="folders-error" style={s.err}>{error}</Text> : null}
      <Pressable testID="folders-add" accessibilityRole="button" disabled={busy || !invoke} onPress={() => void pick()} style={[s.primary, (busy || !invoke) && s.off]}><Text style={s.primaryText}>{busy ? "Adding" : "Add folder"}</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  list: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, paddingLeft: 12, paddingRight: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  name: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  note: { flex: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  x: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  xText: { fontSize: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 13, color: "var(--danger)" as string },
  primary: { height: 34, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "#fff" },
  off: { opacity: 0.45 },
});
