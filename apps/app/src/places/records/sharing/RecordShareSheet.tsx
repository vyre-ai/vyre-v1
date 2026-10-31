// The Share sheet for a record type or a record: the Files sheet (ui/ShareSheet) with the Records line on top, two switches under each person and the export setting under More.
// It reads the shares live, so a change shows at once and a change someone else makes shows too; every choice is one capability call.
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { ShareSheet } from "../../../../../../ui/src/ShareSheet/index.tsx";
import type { Audience, Exporters, RowFlag, ShareDirectory, ShareInput, ShareRow, UnshareInput } from "../../../../../../ui/src/ShareSheet/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useRecordsData } from "../sidebar/data.tsx";
import type { ShareTarget } from "../sidebar/data.tsx";
import { RECORD_LEVELS, audienceCall, exportersCall, flagCall, sheetModel, shareCall, subtitleOf } from "./model.ts";
import type { SharesOut } from "./model.ts";

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as ViewStyle["position"];

export function RecordShareSheet({ target, directory, onClose }: { target: ShareTarget; directory: ShareDirectory; onClose(): void }): ReactElement {
  const data = useRecordsData();
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
  const key = JSON.stringify({ type: target.type, id: target.id });
  const q = useMemo(() => data.live("access.shares_of", { resource: { type: target.type, id: target.id } } as never), [data, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const state = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const [failed, setFailed] = useState<string | null>(null);
  const run = (call: Promise<unknown>): void => { setFailed(null); call.catch((e: unknown) => setFailed(plain(e))); };

  const shell = (inner: ReactElement): ReactElement => (
    <View testID="records-share" accessibilityLabel="Share" style={s.layer} {...(Platform.OS === "web" ? { role: "dialog", "aria-modal": true, onKeyDown: (e: { key: string; stopPropagation?: () => void }) => { if (e.key === "Escape") { e.stopPropagation?.(); onClose(); } } } as object : {})}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.backdrop} />
      <View style={s.center} pointerEvents="box-none">{inner}</View>
    </View>
  );
  if (state.status !== "ready") {
    return shell(<View style={s.card}>{state.status === "error" ? <States kind="error" message="This could not be opened." /> : <States kind="loading" title="Opening" icon="records" />}</View>);
  }

  const out = state.data as unknown as SharesOut;
  const m = sheetModel(out, data.nameOf);
  const res = { type: target.type, id: target.id };
  const ownerName = m.owner?.name ?? "Space owner";
  const records = {
    audience: m.audience as Audience,
    onAudience: (next: Audience) => run(data.call("access.audience_set", audienceCall(res, next))),
    ...(target.type === "record" && target.typeName ? { follows: target.typeName } : {}),
    ...(target.type === "record_type" ? { exporters: m.exporters as Exporters, onExporters: (next: Exporters) => run(data.call("access.audience_set", exportersCall(res, next))) } : {}),
    onFlag: (row: ShareRow, flag: RowFlag, on: boolean) => run(data.call("access.share", flagCall(res, row, flag, on))),
    canChange: m.can.share || m.can.manage,
    subtitle: subtitleOf(target),
  };
  return shell(
    <View style={s.stack}>
      <ShareSheet
        resourceType={target.type} resourceId={target.id} resourceName={target.name} target="item" ownerName={ownerName} {...(m.owner ? { ownerId: m.owner.id } : {})}
        levels={RECORD_LEVELS} shares={m.rows} allowExternal={false} density={phone ? "compact" : "regular"} directory={directory}
        {...(target.typeName ? { folderName: target.typeName } : {})} records={records}
        onShare={(i: ShareInput) => run(data.call("access.share", shareCall(res, i.subject, i.level)))}
        onUnshare={(i: UnshareInput) => run(data.call("access.unshare", { resource: i.resource, subject: i.subject }))}
        onClose={onClose}
      />
      {failed ? <Text accessibilityRole="alert" testID="share-error" style={s.error}>{failed}</Text> : null}
    </View>,
  );
}

function plain(e: unknown): string {
  const x = e as { error?: { message?: string }; message?: string };
  return x?.error?.message ?? x?.message ?? "That did not go through.";
}

const s = StyleSheet.create({
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147482000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" as string },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 520, minHeight: 180, borderRadius: 14, backgroundColor: "var(--raised)" as string, overflow: "hidden", justifyContent: "center" },
  stack: { width: "100%", maxWidth: 520, gap: 8 },
  error: { color: "var(--danger)" as string, fontSize: 12.5, textAlign: "center" },
});
