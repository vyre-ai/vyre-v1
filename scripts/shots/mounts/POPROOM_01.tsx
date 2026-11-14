// Mount for the composer's popovers with little room: ?pos=top is a composer high in a short pane (Attach must open below), ?pos=bottom is a composer at the foot of a pane with room above (Attach stays above).
import type { ReactNode } from "react";
import { View } from "react-native";
import { Composer } from "../../../ui/src/Composer/index.tsx";

export const title = "Composer popover room";

export default function Mount(): ReactNode {
  const pos =
    new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("pos") ?? "top";
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "var(--win)" as string,
        overflow: "hidden",
        justifyContent: pos === "top" ? "flex-start" : "flex-end",
        padding: 24,
      }}
    >
      <View style={{ width: 620, alignSelf: "center", paddingTop: pos === "top" ? 8 : 0 }}>
        <Composer onSend={() => undefined} placeholder="Describe it, or type /" />
      </View>
    </View>
  );
}
