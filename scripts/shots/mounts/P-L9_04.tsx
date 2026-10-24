// Mount for P-L9_04: ui/Composer at the bottom of a conversation column, idle, as in the Chats place.
// The place adds the model and where-it-runs buttons through barExtra, as the prototype does.
import { Pressable, View, useWindowDimensions } from "react-native";
import { Composer, Glyph } from "../../../ui/src/Composer/index.tsx";

export const title = "Composer";

const MODEL = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.500l1.200 3.300 3.300 1.200-3.300 1.200L8 11.500 6.800 8.200 3.500 7l3.300-1.200z"/></svg>';
const LAPTOP = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.500" width="10" height="7" rx="1.200"/><path d="M1.800 12.500h12.400"/></svg>';

function BarButton({ icon, native, label }: { icon: string; native: string; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered }: { hovered?: boolean }) => ({ width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: hovered === true ? "var(--hover)" : "transparent" })}
    >
      <Glyph icon={icon} native={native} color="var(--ink-3)" />
    </Pressable>
  );
}

export default function Mount() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: phone ? 12 : 28, paddingBottom: phone ? 12 : 18 }}>
      <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>
        <Composer
          whoWillAnswer="Intake will reply"
          lead="Intake"
          placeholder={"Message Intake\u2026"}
          label="Message"
          density={phone ? "compact" : "regular"}
          lists={{ agents: ["Intake", "Docs", "Billing"], people: ["Maya Chen", "Omar Haddad"] }}
          barExtra={<><BarButton icon={MODEL} native="*" label="Model: Claude Opus" /><BarButton icon={LAPTOP} native="#" label="Runs on this computer" /></>}
        />
      </View>
    </View>
  );
}
