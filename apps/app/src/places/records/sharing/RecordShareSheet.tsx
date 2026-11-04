// The Share sheet for a record type or a record: the one Access sheet (ui/AccessSheet) with the Records line on top, two switches under each person and the export setting under More.
// It reads the shares live, so a change shows at once and a change someone else makes shows too; every choice is one capability call.
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { AccessSheet } from "../../../../../../ui/src/AccessSheet/index.tsx";
import type { Audience, Exporters, RowFlag, ShareInput, ShareRow, UnshareInput } from "../../../../../../ui/src/AccessSheet/index.tsx";
import { sheetDirectory } from "../../../share/rows.ts";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useRecordsData } from "../sidebar/data.tsx";
import type { ShareTarget } from "../sidebar/data.tsx";
import { RECORD_LEVELS, audienceCall, exportersCall, outsideCall, flagCall, sheetModel, shareCall, subtitleOf } from "./model.ts";
import type { SharesOut } from "./model.ts";

/** The people, groups and agents a Space offers (id and name; a line under the name is optional). */
export interface ShareDirectory { people?: readonly { id: string; name: string }[]; groups?: readonly { id: string; name: string }[]; roles?: readonly { id: string; name: string }[]; agents?: readonly { id: string; name: string }[] }

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as ViewStyle["position"];

export function RecordShareSheet({ target, directory, spaceName, onClose }: { target: ShareTarget; directory: ShareDirectory; spaceName?: string; onClose(): void }): ReactElement {
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
    ...(target.type === "record_type" ? { exporters: m.exporters as Exporters, onExporters: (next: Exporters) => run(data.call("access.audience_set", exportersCall(res, next))), outside: m.outside, onOutside: (on: boolean) => run(data.call("access.audience_set", outsideCall(res, on))) } : {}),
    onFlag: (row: ShareRow, flag: RowFlag, on: boolean) => run(data.call("access.share", flagCall(res, row, flag, on))),
    canChange: m.can.share || m.can.manage,
    subtitle: subtitleOf(target),
  };
  return shell(
    <View style={s.stack}>
      <AccessSheet
        mode="share" itemType={target.type === "record_type" ? "rtype" : "record"} resourceType={target.type} resourceId={target.id} itemName={target.name} target="item" {...(spaceName ? { spaceName } : {})} ownerName={ownerName} {...(m.owner ? { ownerId: m.owner.id } : {})}
        levels={RECORD_LEVELS} shares={m.rows} allowExternal={false} density={phone ? "compact" : "regular"} directory={sheetDirectory({ people: directory.people ?? [], groups: directory.groups ?? [], roles: directory.roles ?? [], agents: directory.agents ?? [] })}
        {...(target.typeName ? { folderName: target.typeName } : {})} {...(out.mine ? { maxLevel: out.mine } : {})} records={records}
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
