// The Records place in the shell (spec 3.6): the sidebar of record types and saved views, and the open type as a table, board, gallery or list. The open type and view are the place's own
// state (the sidebar chooses, the views follow). On a phone width the sidebar is a drawer, so only the view shows. Before the Space's runtime exists the place draws its loading frames.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { View, useWindowDimensions } from "react-native";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider, SidebarLoading } from "../../places/records/sidebar/index.ts";
import { TableLoading } from "../../places/records/table/index.ts";
import { RecordViews } from "../../places/records/views-a/index.ts";
import { recordsData } from "./records-data.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";

const SIDEBAR_W = 240;

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
        <View testID="records-place" style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: SIDEBAR_W }}><RecordsSidebar /></View>}
          <RecordViews />
        </View>
      </RecordsStateProvider>
    </RecordsDataProvider>
  );
}
