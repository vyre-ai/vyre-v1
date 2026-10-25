// Mount for P-UI_03: the shared Menu with a count column and the quiet lit row (ruling 39), open on a plain page.
// The first item is lit (the keyboard highlight); counts sit right-aligned and quiet, checkmarks after them.
import type { ReactNode } from "react";
import { View } from "react-native";
import { Menu } from "../../../ui/src/Menu/index.tsx";

export const title = "Menu";

export default function Mount(): ReactNode {
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Menu
        x={24}
        y={40}
        source="context"
        items={[
          { head: "Channel" },
          { label: "Email", count: 8, checked: true },
          { label: "Text", count: 4 },
          { label: "Call", count: 1 },
          { separator: true },
          { head: "Inbox" },
          { label: "Work Gmail", count: 2, checked: true },
          { label: "hello@", count: 2 },
          { label: "Needs a match", count: 12 },
        ]}
      />
    </View>
  );
}
