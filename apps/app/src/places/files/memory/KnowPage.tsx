// Files > Knowledge > Page. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowPage(_p: { pageId: string; hl?: string }): ReactElement {
  return <View style={frame.main} testID="know-page"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Page" }]} /><KnowColumn testID="know-page-body" label="Page" title="Page">{null}</KnowColumn></View>;
}
