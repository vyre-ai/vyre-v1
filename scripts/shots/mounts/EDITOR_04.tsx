// Mount for l-editor: a chat reply with a table, a checklist, a code block and the rest of the Markdown a model writes, drawn by the stream renderer in a message column (the width of a chat on a computer, the screen on a phone).
import { View, useWindowDimensions } from "react-native";
import { MarkdownBlocks, createIncrementalMarkdown } from "../../../ui/src/stream/index.ts";

export const title = "Chat reply with a table";

const REPLY = [
  "Here is the plan for the Rivera matter. I split it by owner so each person sees their own part.",
  "",
  "## Steps",
  "",
  "| Step | Owner | Due | Notes |",
  "|---|:---:|---:|---|",
  "| Draft the engagement letter | Dex | Fri | Uses the **standard** template |",
  "| Collect the intake form | Mira | Mon | Chase the client twice, then call |",
  "| Run the conflict check | Sol | Mon | See `conflicts/rivera.md` |",
  "| Send the letter to Sara for review | Dex | Tue | [Open the draft](https://example.com/draft) |",
  "",
  "Before anything goes out:",
  "",
  "- [x] The retainer is paid",
  "- [ ] Sara has read the letter",
  "- [ ] The client has the portal link",
  "",
  "```sh",
  "vyre send --to sara --file letters/rivera-engagement.md",
  "```",
  "",
  "> Nothing is sent to the client until you have seen it.",
].join("\n");

export default function Mount() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const md = createIncrementalMarkdown();
  md.append(REPLY);
  md.finish();
  return (
    <View style={{ flex: 1, alignItems: "center", paddingTop: 32, paddingHorizontal: phone ? 16 : 28 }}>
      <View style={{ width: "100%", maxWidth: 700 }} testID="reply">
        <MarkdownBlocks blocks={md.view().blocks} />
      </View>
    </View>
  );
}
