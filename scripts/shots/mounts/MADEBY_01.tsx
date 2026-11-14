// Mount for the made-for-me row (owner rule, 14 Nov 2026): the one Access sheet on a file whose sharing list shows the agent that made it, Dex, with its one quiet line "Made this for you", its level and the remove control,
// next to an ordinary row (Omar). The real component with its frozen share props; nothing else is on the page. scripts/shots/madeby-shoot.mjs shoots it in paper and graphite.
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AccessSheet, frozenShareSheetProps } from "../../../ui/src/AccessSheet/index.tsx";

export const title = "Made this for you";

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string, alignItems: "center", justifyContent: "center" }}>
      <AccessSheet
        {...frozenShareSheetProps}
        itemName="Q4 invoices"
        shares={[
          {
            subjectKind: "agent",
            subjectId: "agt_dex",
            name: "Dex",
            level: "edit",
            via: "grant",
            fromFolderId: null,
            madeBy: true,
          },
          {
            subjectKind: "person",
            subjectId: "usr_omar",
            name: "Omar Reyes",
            level: "view",
            via: "grant",
            fromFolderId: null,
          },
        ]}
      />
    </View>
  );
}
