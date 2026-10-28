// The Records place in the shell (spec 3.6): the sidebar of record types and saved views in the shell's shared place sidebar slot (P-L9d_22), and the open type as a table, board, gallery or list.
// The open type and view are the place's own state (the sidebar chooses, the views follow). On a phone the sidebar is the list and the view opens when a row is chosen. Before the Space's runtime
// exists the place draws its loading frames.
import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebarSlot, RecordsStateProvider, SidebarLoading } from "../../places/records/sidebar/index.ts";
import { TableLoading } from "../../places/records/table/index.ts";
import { usePlaceHash, useOpenedId } from "../hash/context.tsx";
import { RecordDetail } from "./record-detail.tsx";
import { useRecordsState } from "../../places/records/sidebar/state.tsx";
import { useScreenQuery } from "../../places/records/sidebar/data.tsx";
import { SCREENS, effectiveType, typeGroups } from "../../places/records/sidebar/model.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { RecordViews } from "../../places/records/views-a/index.ts";
import { recordsData } from "./records-data.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

const SIDEBAR_W = 240;

function RecordsBody({ rt }: { rt: ShellRuntime }): ReactElement {
  const { target, opened } = usePlaceHash();
  const id = useOpenedId(["record", "contact", "project"], ["recordId", "projectId"]);
  const { state } = useRecordsState();
  const previousType = useRef(state.type);
  useEffect(() => {
    if (previousType.current !== state.type && id) opened({});
    previousType.current = state.type;
  }, [state.type, id, opened]);
  const types = useScreenQuery<CapMap["schema.types.list"]["out"]>(SCREENS.types, "types");
  const type = target.args.type ?? effectiveType(state, typeGroups(types.status === "ready" ? types.data.types : []));
  const data = useMemo(() => {
    const base = recordsData(rt);
    return { ...base, nav: { ...base.nav, openRecord: (recordId: string) => rt.open({ subject: { type: "record", id: recordId }, args: type ? { type } : {} }) } };
  }, [rt, type]);
  return <RecordsDataProvider value={data}><View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}><RecordsSidebarSlot />{id ? <RecordDetail key={`${id}:${target.args.type ?? ""}`} rt={rt} recordId={id} {...(target.args.type ? { type: target.args.type } : {})} fields={target.screen === "records.record-page"} /> : <RecordViews {...(target.args.type ? { type: target.args.type } : {})} />}</View></RecordsDataProvider>;
}

export default function RecordsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const data = useMemo(() => (rt ? recordsData(rt) : null), [rt]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
  if (!data) {
    return (
      <View testID="records-place-loading" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        {phone ? null : <View style={{ width: SIDEBAR_W }}><SidebarLoading /></View>}
        <TableLoading />
      </View>
    );
  }
  return (
    <RecordsDataProvider value={data}>
      <RecordsStateProvider>
        <RecordsBody rt={rt!} />
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}
