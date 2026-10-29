// Files > Knowledge > Learned. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowLearned(): ReactElement {
  return <View style={frame.main} testID="know-learned"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Learned" }]} /><KnowColumn testID="know-learned-body" label="Learned" title="Learned">{null}</KnowColumn></View>;
}
