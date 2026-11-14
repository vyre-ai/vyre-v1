// Mount for ui/LiveSurface: the four states in one box size, and the corner mark. The still is a drawn stand-in for a browser picture.
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { LiveSurface } from "../../../ui/src/LiveSurface/index.tsx";

export const title = "LiveSurface";
const STILL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABBUlEQVR4nO3WQQ2EQAAEwfUvABE4wME6QAQG7nkSeJENTSUlYJL+zJjzJGwsX8CjBI4TOE7gOIHjBI4TOE7gOIHjxnX9CBM4TuA4geMEjhM4TuA4geMEjhM4TuC4+8Dbtn/H8h4CCyywwAILLHCEFx0ncJzAcQLHCRwncJzAcQLHCRx3H/g4Jk8TOE7guJWBeTWB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzjuD6qq+53GRf16AAAAAElFTkSuQmCC";
const none = (): void => undefined;

export default function Mount(): ReactNode {
  const still = { uri: STILL, at: Date.parse("2026-11-13T14:32:00Z") };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "var(--win)" as string,
        padding: 24,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      {[
        <LiveSurface
          key="a"
          kind="picture"
          aspect={16 / 9}
          state="starting"
          stage="Installing tools"
          startedAt={Date.now() - 4000}
          still={still}
        />,
        <LiveSurface key="b" kind="stream" aspect={16 / 9} state="live" still={still} mode="watching" />,
        <LiveSurface key="c" kind="picture" aspect={16 / 9} state="asleep" still={still} onPress={none} />,
        <LiveSurface
          key="d"
          kind="picture"
          aspect={16 / 9}
          state="failed"
          failure={{ message: "The computer ran out of disk." }}
          onRetry={none}
        />,
        <LiveSurface key="e" kind="terminal" aspect={16 / 9} state="live" mode="control">
          <Text
            style={{ color: "#9f9" as string, fontFamily: "ui-monospace, Menlo, monospace", padding: 12, fontSize: 13 }}
          >
            {"$ npm test\n12 passed"}
          </Text>
        </LiveSurface>,
      ].map((el) => (
        <View key={el.key} style={{ width: 420 }}>
          {el}
        </View>
      ))}
    </View>
  );
}
