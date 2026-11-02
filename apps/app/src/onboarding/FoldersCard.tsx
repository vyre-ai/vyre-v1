// The "Local folders" step on the desktop: the system folder dialog (the shell's pick_paths), and each pick is mounted at once through mounts.add, the call Files uses.
// A row says Adding, then Added with a check, or fails with Retry. Removing an Added row unmounts it (mounts.remove). Continue only moves on.
// The folders stay on this computer (live only). On the web and the phone the step keeps the card that opens Files.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { baseName, mountLocalFolder, mountPlace, parentOf, pickFolders, shellInvoke, unmountFolder } from "../shell/providers/local-folder-mount.ts";
import type { Invoke, MountPlace } from "../shell/providers/local-folder-mount.ts";
import { CARD } from "./card-style.ts";

export { shellInvoke };

type Status = "adding" | "added" | "failed";
interface FolderRow { path: string; status: Status; mountId?: string }

export function FoldersCard({ call, gate, invoke = shellInvoke() }: { call: CapCall; gate?(save: (() => Promise<boolean>) | null): void; invoke?: Invoke | undefined }): ReactElement {
  const [rows, setRows] = useState<readonly FolderRow[]>([]);
  const [error, setError] = useState("");
  const where = useRef<MountPlace | null>(null);
  const set = (path: string, patch: Partial<FolderRow>): void => setRows((old) => old.map((r) => (r.path === path ? { ...r, ...patch } : r)));
  const mount = async (path: string): Promise<void> => {
    set(path, { status: "adding" });
    try {
      const at = where.current ?? (await mountPlace(call));
      if (!at) { set(path, { status: "failed" }); setError("This computer is not ready to share folders yet. Try again in a moment."); return; }
      where.current = at;
      const out = await mountLocalFolder(call, path, at);
      set(path, { status: "added", ...(out.mountId ? { mountId: out.mountId } : {}) });
    } catch { set(path, { status: "failed" }); setError(`Could not add ${baseName(path)}. Try again.`); }
  };
  const pick = async (): Promise<void> => {
    if (!invoke) return;
    setError("");
    let next: string[];
    try { next = await pickFolders(invoke); } catch { setError("Could not open the folder dialog."); return; }
    const fresh = next.filter((p) => !rows.some((r) => r.path === p));
    if (fresh.length === 0) return;
    setRows((old) => [...old, ...fresh.map((path): FolderRow => ({ path, status: "adding" }))]);
    for (const path of fresh) void mount(path);
  };
  const remove = async (r: FolderRow): Promise<void> => {
    if (r.status === "adding") return;
    setError("");
    if (r.status === "added" && r.mountId) {
      try { await unmountFolder(call, r.mountId); } catch { setError(`Could not remove ${baseName(r.path)}. Try again.`); return; }
    }
    setRows((old) => old.filter((x) => x.path !== r.path));
  };
  const added = rows.filter((r) => r.status === "added").length;
  const adding = rows.some((r) => r.status === "adding");
  useEffect(() => {
    if (!gate) return undefined;
    gate(added > 0 && !adding ? async () => true : null);
    return () => gate(null);
  });
  const list: ReactElement[] = [];
  rows.forEach((r, i) => {
    list.push(
      <View key={r.path} testID={`folder-row-${i}`} style={s.row}>
        <Text style={s.name} numberOfLines={1}>{baseName(r.path)}</Text>
        <Text style={s.note} numberOfLines={1}>{parentOf(r.path)}</Text>
        {r.status === "adding" ? <Text testID={`folder-status-${i}`} style={s.state}>Adding</Text> : null}
        {r.status === "added" ? <Text testID={`folder-status-${i}`} accessibilityLabel="Added" style={s.ok}>{"Added \u2713"}</Text> : null}
        {r.status === "failed" ? <Pressable testID={`folder-retry-${i}`} accessibilityRole="button" accessibilityLabel={`Retry ${baseName(r.path)}`} onPress={() => { setError(""); void mount(r.path); }} style={s.retry}><Text style={s.retryText}>Retry</Text></Pressable> : null}
        <Pressable testID={`folder-remove-${i}`} accessibilityRole="button" accessibilityLabel={`Remove ${baseName(r.path)}`} disabled={r.status === "adding"} onPress={() => void remove(r)} style={[s.x, r.status === "adding" && s.dim]}><Text style={s.xText}>{"\u00d7"}</Text></Pressable>
      </View>,
    );
  });
  return (
    <View testID="folders-card" style={s.col}>
      {list.length > 0 ? <View style={s.list}>{list}</View> : null}
      {error ? <Text accessibilityRole="alert" testID="folders-error" style={s.err}>{error}</Text> : null}
      <Pressable testID="folders-add" accessibilityRole="button" disabled={!invoke} onPress={() => void pick()} style={[s.primary, !invoke && s.off]}><Text style={[s.primaryText, !invoke && s.offText]}>Add folder</Text></Pressable>
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
  state: { fontSize: 12.5, color: "var(--ink-3)" as string },
  ok: { fontSize: 12.5, color: "var(--accent)" as string },
  retry: { height: 28, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  err: CARD.err,
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  off: CARD.off,
  offText: CARD.offText,
  dim: { opacity: 0.45 },
});
