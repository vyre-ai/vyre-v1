// Ask Vyre explains an error. The person sees the scrubbed bundle before it opens. It does not publish, re-run, or change access.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { scrubAskContext } from "./bundle.ts";
import type { AskBundle } from "./bundle.ts";

export function AskVyre({ bundle, onOpen, showShare = false, testID = "ask-vyre" }: {
  bundle: AskBundle;
  onOpen?: (bundle: AskBundle) => void;
  /** Tests pin the disclosure open so the shared fields are in the markup. */
  showShare?: boolean;
  testID?: string;
}): ReactElement {
  const [open, setOpen] = useState(showShare);
  const safe = scrubAskContext({ ...bundle });
  return (
    <View testID={testID} style={s.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ask Vyre" testID="ask-vyre-share" onPress={() => setOpen(true)} style={s.btn}>
        <Text style={s.btnText}>Ask Vyre</Text>
      </Pressable>
      {open ? (
        <View testID="ask-vyre-bundle" style={s.share}>
          <Text style={s.copy}>This is what will be shared. Secrets, authorization headers, cookies and request bodies stay out. Ask Vyre can explain and propose. It will not publish, re-run live, or change permissions.</Text>
          <Text testID="ask-vyre-json" style={s.json}>{JSON.stringify(safe)}</Text>
          {onOpen ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open Ask Vyre" testID="ask-vyre-open" onPress={() => onOpen(safe)} style={s.btn}>
              <Text style={s.btnText}>Open Ask Vyre</Text>
            </Pressable>
          ) : <Text style={s.copy}>Ask Vyre is not available from this screen.</Text>}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  share: { gap: 8, padding: 8, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  copy: { fontSize: 12, lineHeight: 17, color: "var(--ink-2)" as string },
  json: { fontSize: 11, lineHeight: 16, color: "var(--ink-3)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  btn: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  btnText: { fontSize: 12.5, color: "var(--accent)" as string },
});
