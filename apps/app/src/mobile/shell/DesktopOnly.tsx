// What a phone shows for a link to Automations or the Console (owner ruling, 3 Nov 2026: "You can chat about them in chats na so not needed in phone"). One calm line and one action,
// "Chat about it", which opens an Ask with the assistant about the item the link named. Never a blank screen and never a broken route.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export const CHAT_ABOUT_IT = "Chat about it";

export function DesktopOnly({ line, onChat, testID = "desktop-only" }: { line: string; onChat?: () => void; testID?: string }): ReactElement {
  const [down, setDown] = useState(false);
  return (
    <View testID={testID} style={st.fill}>
      <View style={st.box}>
        <Text accessibilityRole="text" style={st.line}>{line}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={CHAT_ABOUT_IT}
          testID={`${testID}-chat`}
          disabled={onChat === undefined}
          onPress={onChat}
          onPressIn={() => setDown(true)}
          onPressOut={() => setDown(false)}
          style={[st.button, down && st.buttonDown, onChat === undefined && st.buttonOff]}
        >
          <Text style={st.buttonText}>{CHAT_ABOUT_IT}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, padding: 16, justifyContent: "flex-start" },
  box: { gap: 12, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  line: { color: "var(--ink-2)" as string, fontSize: 15, lineHeight: 21 },
  button: { alignSelf: "flex-start", height: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  buttonDown: { opacity: 0.85 },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: "var(--accent-ink)" as string, fontSize: 15, fontWeight: "600" },
});
