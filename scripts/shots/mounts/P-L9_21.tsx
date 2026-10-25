// Mount for P-L9_21: the shell's main tab strip with four open tabs (each with its place icon, the + right after the last tab) over an empty body.
import { useState } from "react";
import { View } from "react-native";
import { MainTabs } from "../../../apps/app/src/shell/tabs/MainTabs.tsx";
import { createTabsController } from "../../../apps/app/src/shell/tabs/store.ts";

export const title = "Main tab strip";

export default function Mount() {
  const [controller] = useState(() => {
    const c = createTabsController({ deviceId: "d1", personId: "p1", spaceId: "northwind", storage: null, start: "home" });
    c.openPlace("chats");
    c.openPlace("records");
    c.openPlace("files");
    return c;
  });
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <MainTabs controller={controller} />
    </View>
  );
}
