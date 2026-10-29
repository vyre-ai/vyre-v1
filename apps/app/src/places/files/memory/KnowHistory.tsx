// Files > Knowledge > History. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowHistory(_p: { pageId?: string }): ReactElement {
  return <View style={frame.main} testID="know-history"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "History" }]} /><KnowColumn testID="know-history-body" label="History" title="History">{null}</KnowColumn></View>;
}
