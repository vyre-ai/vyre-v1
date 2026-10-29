// Files > Knowledge > Topics. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowList(_p: { kind: import("./know.ts").ListKind }): ReactElement {
  return <View style={frame.main} testID="know-list"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Topics" }]} /><KnowColumn testID="know-list-body" label="Topics" title="Topics">{null}</KnowColumn></View>;
}
