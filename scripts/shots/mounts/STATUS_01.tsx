// Mount for ui/Status: every state of a unit (contract P3 section 6), as a block, as a one-line bar and inline in a row.
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Status } from "../../../ui/src/Status/index.tsx";

export const title = "Status";

const none = (): void => undefined;
const STATES = [
  { tone: "quiet", label: "Not made yet" },
  { tone: "warn", label: "Starting, installing tools, 4 s", note: "Opening the computer" },
  { tone: "ok", label: "Running: npm run build" },
  { tone: "quiet", label: "Asleep. Starts when something uses it." },
  { tone: "warn", label: "Waiting for room: 3 ahead", note: "It starts by itself." },
  {
    tone: "bad",
    label: "The computer ran out of disk",
    action: { label: "Retry", onPress: none },
    alt: { label: "Copy details", onPress: none },
  },
  { tone: "mine", label: "Dana has the keyboard", action: { label: "Give back", onPress: none } },
] as const;

export default function Mount(): ReactNode {
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string, padding: 32, gap: 16, maxWidth: 560 }}>
      {STATES.map((s) => (
        <Status key={s.label} {...s} />
      ))}
      <Text style={{ color: "var(--ink-3)" as string, fontSize: 12, marginTop: 8 }}>One-line bar</Text>
      <Status tone="mine" label="Dana has the keyboard" bar action={{ label: "Give back", onPress: none }} />
      <Text style={{ color: "var(--ink-3)" as string, fontSize: 12, marginTop: 8 }}>Inline</Text>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Status tone="ok" label="Signed" inline />
        <Status tone="bad" label="Declined" inline />
        <Status tone="warn" label="Not signed in time" inline />
        <Status tone="quiet" label="Sent" inline />
      </View>
    </View>
  );
}
