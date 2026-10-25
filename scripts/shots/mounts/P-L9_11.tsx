// Mount for P-L9_11: the seven part-one chat blocks in an agent conversation, the way the prototype's agent-native chat shows them.
// ?part=a plan + question, ?part=b terminal + mount + changeset, ?part=c deploy + record card. Every button works against a fake host:
// a press shows what it called in the strip under the chat.
import { useCallback, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { BlockViewA } from "../../../ui/src/blocks/impl-a/index.tsx";
import type { BlockHost } from "../../../ui/src/blocks/impl-a/index.tsx";
import { SAMPLE_CHANGESET, SAMPLE_DEPLOY, SAMPLE_MOUNT, SAMPLE_PLAN, SAMPLE_QUESTION, SAMPLE_RECORD, SAMPLE_TERMINAL } from "../../../ui/src/blocks/impl-a/sample.ts";
import type { Block } from "../../../ui/src/kit/types.ts";

export const title = "Chat blocks, part 1";

interface Turn {
  who: string;
  at: string;
  text: string;
  blocks: Block[];
}

const PARTS: Record<string, Turn[]> = {
  a: [
    { who: "You", at: "9:40", text: "A new client is coming in this afternoon. Get everything ready for her intake.", blocks: [] },
    { who: "Intake", at: "9:40", text: "Here is how I would do it. Plan mode is on, so I have not touched anything yet.", blocks: [SAMPLE_PLAN, SAMPLE_QUESTION] },
  ],
  b: [
    { who: "Intake", at: "9:42", text: "Plan approved. I checked the form fields first.", blocks: [SAMPLE_TERMINAL, SAMPLE_MOUNT] },
    { who: "Intake", at: "9:46", text: "The form copy and the letter changed. Please look at the diff before I send anything.", blocks: [SAMPLE_CHANGESET] },
  ],
  c: [{ who: "Intake", at: "9:48", text: "Booking widget is up. Elena is on the record.", blocks: [SAMPLE_DEPLOY, SAMPLE_RECORD] }],
};

function part(): string {
  const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
  const p = new URLSearchParams(search).get("part") ?? "a";
  return p in PARTS ? p : "a";
}

export default function Mount() {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const [log, setLog] = useState<string[]>([]);
  const note = useCallback((line: string) => setLog((l) => [line, ...l].slice(0, 3)), []);
  const host: BlockHost = {
    invoke: (cap, input) => note(`${cap} ${JSON.stringify(input)}`),
    open: (tab, input) => note(`open ${tab} ${JSON.stringify(input)}`),
    openUrl: (url) => note(`open ${url}`),
  };
  const turns = PARTS[part()] ?? [];
  return (
    <View style={{ flex: 1, paddingHorizontal: phone ? 12 : 28, paddingTop: phone ? 12 : 22 }}>
      <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>
        {turns.map((t, i) => (
          <View key={i} style={{ marginBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={{ color: "var(--ink)", fontSize: 13, fontWeight: "600" }}>{t.who}</Text>
              <Text style={{ color: "var(--ink-4)", fontSize: 11.5 }}>{t.at}</Text>
            </View>
            <Text style={{ color: "var(--ink)", fontSize: 14, lineHeight: 21 }}>{t.text}</Text>
            {t.blocks.map((b) => (
              <BlockViewA key={b.id} block={b} host={host} />
            ))}
          </View>
        ))}
        {log.length > 0 ? (
          <View testID="host-log" style={{ marginTop: 8 }}>
            {log.map((l, i) => (
              <Text key={i} numberOfLines={1} style={{ color: "var(--ink-3)", fontSize: 11.5 }}>{l}</Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
