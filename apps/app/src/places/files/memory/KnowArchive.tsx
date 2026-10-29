// Files > Knowledge > Archive. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowArchive(): ReactElement {
  return <View style={frame.main} testID="know-archive"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Archive" }]} /><KnowColumn testID="know-archive-body" label="Archive" title="Archive">{null}</KnowColumn></View>;
}
