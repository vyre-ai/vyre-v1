// Mount for l-editor: the golden "every format" reply (table, task list, strikethrough, autolink, footnote, diagram, math, code, chart, callout, details, image) drawn by the stream renderer, so both skins and both widths can be looked at.
import { ScrollView, View, useWindowDimensions } from "react-native";
import { MarkdownBlocks, createIncrementalMarkdown } from "../../../ui/src/stream/index.ts";

export const title = "Every format";

const REPLY = [
  "# Plan", "", "Intro with **bold**, ~~old~~, `code`, a [link](https://example.com) and https://example.org/auto.[^1]", "",
  "| Option | Monthly | Uptime |", "|---|---:|---:|", "| Railway | $48 | 99.9% |", "| Fly.io | $39 | 99.95% |", "",
  "- [x] Pick the host", "- [ ] Move the data", "",
  "```mermaid", "flowchart LR", "  A[Upload] --> B{Under 2 GB?}", "```", "",
  "Inline $E = mc^2$ and display:", "", "$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$", "",
  "```ts", "const limit = 2_000_000_000;", "```", "",
  "```chart", '{"type":"bar","labels":["Jan","Feb"],"series":[{"name":"Uploads","data":[42,55]}]}', "```", "",
  "> [!NOTE]", "> Files over 2 GB are refused.", "",
  "<details>", "<summary>Method</summary>", "", "Measured three times.", "", "</details>", "",
  "![Portal](https://example.com/portal.png)", "", "[^1]: Provider status pages.", "",
].join("\n");

export default function Mount() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const md = createIncrementalMarkdown();
  md.append(REPLY);
  md.finish();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: "center", paddingTop: 24, paddingBottom: 40, paddingHorizontal: phone ? 16 : 28 }}>
      <View style={{ width: "100%", maxWidth: 700 }} testID="reply"><MarkdownBlocks blocks={md.view().blocks} /></View>
    </ScrollView>
  );
}
