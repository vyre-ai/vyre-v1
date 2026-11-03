// Mount for l-editor: the chat composer in a column, with the plain field (?field=plain) or the shared-editor field with mention chips (?field=chat), and a line that prints each payload it sends, so a browser test
// can type into it, pick a mention, send, and compare the two fields' payloads. The query is read after mount (rule 25).
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Composer } from "../../../ui/src/Composer/index.tsx";

export const title = "Composer field test";

export default function Mount() {
  const [field, setField] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  useEffect(() => { setField(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("field") ?? "plain"); }, []);
  if (field === null) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", paddingHorizontal: 28, paddingBottom: 18 }}>
      <Text testID="sent" style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8 }}>{JSON.stringify(sent)}</Text>
      <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>
        <Composer
          whoWillAnswer="Aliza will reply" lead="Aliza" label="Message" placeholder="Message" lists={{ agents: ["Aliza", "Rubab", "Sol"], people: [] }}
          chatField={field !== "plain"} onSubmit={(p) => setSent((s) => [...s, JSON.stringify({ text: p.text, links: p.links, refs: p.refs, mode: p.mode, answers: p.answers })])}
        />
      </View>
    </View>
  );
}
