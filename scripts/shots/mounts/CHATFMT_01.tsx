// Mount for l-chatfmt: one agent reply that uses every chat format: marks, sections, choices, ticks, a table, a chart and a flow chart.
import { ScrollView, View, useWindowDimensions } from "react-native";
import { MarkdownBlocks, createIncrementalMarkdown } from "../../../ui/src/stream/index.ts";

export const title = "Rich reply";

const REPLY = [
  "## Where the launch stands", "",
  "The build is **green**, the copy is *final*, and the ++release notes++ are still open. ==Do not ship before legal signs off.== Old plan: ~~Friday~~. See `rc.22` or the [notes](https://example.com/notes).", "",
  "> [!section+] What changed this week",
  "> Three fixes landed: the Space clock, the sidebar, and the long-chat scroll.",
  "> - Space clock: set once in Console",
  "> - Sidebar: one place for every chat",
  "> - Long chats: only the rows near the screen are drawn", "",
  "> [!section] Why the install failed on Windows",
  "> The signer rejected the key. Rotate it, then rebuild.", "",
  "> [!section] Open risks",
  "> Two items need an owner before Friday.", "",
  "| Lane | Status | Tests |", "|---|---|---:|", "| Chat format | Done | 41 |", "| Cards | In review | 28 |", "",
  "```chart", '{"type":"bar","title":"Messages per day","labels":["Mon","Tue","Wed","Thu"],"series":[{"name":"Sent","data":[120,180,90,240]}]}', "```", "",
  "```mermaid", "flowchart LR", "  A[Draft] --> B{Legal OK?}", "  B -->|yes| C[Ship]", "  B -->|no| A", "```", "",
  "- [x] Cut the build", "- [ ] Get legal sign-off", "- [ ] Post the notes", "",
  "What next?", "", "```choices", "Ship now", "Wait for legal", "Ask Dana", "```", "",
].join("\n");

export default function Mount() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const md = createIncrementalMarkdown();
  md.append(REPLY);
  md.finish();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: "center", paddingTop: 24, paddingBottom: 40, paddingHorizontal: phone ? 16 : 28 }}>
      <View style={{ width: "100%", maxWidth: 700 }} testID="reply"><MarkdownBlocks blocks={md.view().blocks} scope="shot" onChoose={() => undefined} /></View>
    </ScrollView>
  );
}
