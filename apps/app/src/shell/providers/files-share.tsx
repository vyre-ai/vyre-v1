// Share a folder: the same sheet Records uses (ui/ShareSheet), on the folder through access.share. It reads the shares live, so a change shows at once.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { ShareSheet } from "../../../../../ui/src/ShareSheet/index.tsx";
import type { ShareInput, UnshareInput } from "../../../../../ui/src/ShareSheet/index.tsx";
import { States } from "../../../../../ui/src/States/index.tsx";
import { RECORD_LEVELS, sheetModel } from "../../places/records/sharing/model.ts";
import type { SharesOut } from "../../places/records/sharing/model.ts";
import { useDirectory } from "./automations-parts.tsx";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as ViewStyle["position"];

export function FolderShareSheet({ rt, folderId, onClose }: { rt: ShellRuntime; folderId: string; onClose(): void }): ReactElement {
  // the sheet is titled with the folder's own name
  const [name, setName] = useState("Folder");
  useEffect(() => {
    let live = true;
    void Promise.resolve(rt.call("files.list", {})).then((o) => { const f = (o as { folders?: Array<{ folderId?: string; id?: string; name: string }> }).folders?.find((x) => (x.folderId ?? x.id) === folderId); if (live && f) setName(f.name); }, () => undefined);
    return () => { live = false; };
  }, [rt, folderId]);
  const directory = useDirectory(rt);
  const nameOf = useMemo(() => nameLookup(rt), [rt]);
  const q = useMemo(() => capLive<SharesOut>(rt, "access.shares_of", { resource: { type: "folder", id: folderId } }), [rt, folderId]);
  const state = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const [failed, setFailed] = useState<string | null>(null);
  const run = (call: Promise<unknown>): void => { setFailed(null); call.catch((e: unknown) => { const x = e as { error?: { message?: string }; message?: string }; setFailed(x?.error?.message ?? x?.message ?? "That did not go through."); }); };
  const shell = (inner: ReactElement): ReactElement => (
    <View testID="files-share" accessibilityLabel="Share" style={s.layer}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.backdrop} />
      <View style={s.center} pointerEvents="box-none">{inner}</View>
    </View>
  );
  if (state.status !== "ready") return shell(<View style={s.card}>{state.status === "error" ? <States kind="error" message="This could not be opened." /> : <States kind="loading" title="Opening" icon="files" />}</View>);
  const m = sheetModel(state.data, nameOf);
  const res = { type: "folder", id: folderId };
  return shell(
    <View style={s.stack}>
      <ShareSheet
        resourceType="folder" resourceId={folderId} resourceName={name} target="folder" ownerName={m.owner?.name ?? "Space owner"} {...(m.owner ? { ownerId: m.owner.id } : {})}
        levels={RECORD_LEVELS} shares={m.rows} allowExternal={false} density="regular" directory={directory}
        onShare={(i: ShareInput) => run(rt.call("access.share", { resource: res, subject: i.subject, level: i.level }))}
        onUnshare={(i: UnshareInput) => run(rt.call("access.unshare", { resource: i.resource, subject: i.subject }))}
        onClose={onClose}
      />
      {failed ? <Text accessibilityRole="alert" testID="share-error" style={s.error}>{failed}</Text> : null}
    </View>,
  );
}

const s = StyleSheet.create({
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147482000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" as string },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 520, minHeight: 180, borderRadius: 14, backgroundColor: "var(--raised)" as string, overflow: "hidden", justifyContent: "center" },
  stack: { width: "100%", maxWidth: 520, gap: 8 },
  error: { color: "var(--danger)" as string, fontSize: 12.5, textAlign: "center" },
});
