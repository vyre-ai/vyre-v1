// A file's history (spec 2.14; screen files.history): the shared ui/HistoryTab over files.versions, with Compare opening a diff tab, Restore (which asks first) and Name this version.
// The tab does the listing, the selection and the restore; this wires its data and adds the one thing the tab does not have, giving a version a name that stays through the thinning of old versions.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { HistoryTab } from "../../../../../../ui/src/HistoryTab/index.tsx";
import type { Density, HistoryVersion } from "../../../../../../ui/src/HistoryTab/index.tsx";
import { nameVersion } from "./actions.ts";
import { useCap, useReviewData } from "./data.tsx";
import { historyVersions } from "./model.ts";
import { Btn, Note, Skeleton, TextField } from "./parts.tsx";

export interface HistoryPanelProps {
  fileId: string;
  density?: Density;
}

export function HistoryPanel({ fileId, density = "regular" }: HistoryPanelProps): ReactElement {
  const data = useReviewData();
  const q = useCap("files.versions", { fileId });
  const versions = useMemo(() => (q.status === "ready" ? historyVersions(q.data.versions, data.nameOf) : []), [q, data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [line, setLine] = useState<{ text: string; kind: "ok" | "error" } | null>(null);

  if (q.status !== "ready") return <Skeleton height={120} testID="history-loading" />;

  const top = versions.reduce<HistoryVersion | null>((a, v) => (a === null || v.n > a.n ? v : a), null);
  const selected = versions.find((v) => v.id === picked) ?? top;

  const startNaming = (): void => {
    if (!selected) return;
    setName(selected.why);
    setNaming(true);
    setLine(null);
  };
  const saveName = (): void => {
    if (!selected) return;
    void nameVersion(data.call, fileId, selected.id, name).then((r) => {
      if (r.ok) { setNaming(false); setLine({ kind: "ok", text: name.trim() ? `Named version ${selected.n} "${name.trim()}".` : `Cleared the name of version ${selected.n}.` }); }
      else setLine({ kind: "error", text: r.error });
    });
  };

  return (
    <View style={st.wrap} testID="history-panel">
      <HistoryTab
        resourceType="file"
        resourceId={fileId}
        versions={versions}
        selectedVersionId={selected?.id ?? null}
        density={density}
        onSelect={setPicked}
        onCompare={(version, against) => data.nav.compare(fileId, against.id, version.id)}
        invoke={(cap, input) => data.call(cap, input)}
      />
      <View style={st.bar}>
        {naming ? (
          <>
            <TextField value={name} onChange={setName} label="Version name" placeholder="Name this version" onSubmit={saveName} onEscape={() => setNaming(false)} testID="history-name" autoFocus />
            <Btn label="Cancel" small onPress={() => setNaming(false)} testID="history-name-cancel" />
            <Btn label="Save name" small primary onPress={saveName} testID="history-name-save" />
          </>
        ) : (
          <Btn label="Name this version" small disabled={!selected} hint="Pick a version first" onPress={startNaming} testID="history-name-open" />
        )}
      </View>
      {line ? <Note text={line.text} kind={line.kind} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { width: "100%" },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
});
