// Files > Knowledge > Trash. (placeholder: the screen is built in its own change; it draws the shared frame so the router and the sidebar already work)
import type { ReactElement } from "react";
import { View } from "react-native";
import { KnowColumn, KnowHeader, frame } from "./KnowFrame.tsx";

export function KnowTrash(_p: { pageId?: string }): ReactElement {
  return <View style={frame.main} testID="know-trash"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Trash" }]} /><KnowColumn testID="know-trash-body" label="Trash" title="Trash">{null}</KnowColumn></View>;
}
