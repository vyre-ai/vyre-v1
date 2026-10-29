// Files > Knowledge > Search. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowSearch(_p: { q: string }): ReactElement {
  return <View style={frame.main} testID="know-search"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Search" }]} /><KnowColumn testID="know-search-body" label="Search" title="Search">{null}</KnowColumn></View>;
}
