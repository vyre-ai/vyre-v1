// Mount for l-editor: an empty shared Markdown editor opened with autoFocus, as a new note opens, and a line that prints what it handed back (onChange), so a browser test can type the moment it opens.
import { useState } from "react";
import { Text, View } from "react-native";
import { MarkdownEditor } from "../../../ui/src/RichEditor/index.tsx";

export const title = "Editor typed right after open";

export default function Mount() {
  const [v, setV] = useState("");
  return (
    <View style={{ flex: 1, padding: 28 }}>
      <Text testID="typed" style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8 }}>{JSON.stringify(v)}</Text>
      <View style={{ maxWidth: 640 }}><MarkdownEditor testID="early" label="Note" value={v} onChange={setV} placeholder="Take a note" bare density="compact" minHeight={44} autoFocus /></View>
    </View>
  );
}
