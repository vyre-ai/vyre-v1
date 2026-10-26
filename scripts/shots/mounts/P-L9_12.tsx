// Mount for P-L9_12: the seven part-two chat blocks in an agent conversation, the way the prototype's agent-native chat shows them.
// ?part=a memory, vault use, sub-task model switch and helper; ?part=b secret input, access request and diff card. Every button works against a fake host:
// a press shows what it called in the strip under the chat. A saved secret shows only as hidden dots there.
import { useCallback, useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { BlockViewB, redactSecretInput } from "../../../ui/src/blocks/impl-b/index.tsx";
import type { BlockHostB } from "../../../ui/src/blocks/impl-b/index.tsx";
import { SAMPLE_ACCESS_REQUEST, SAMPLE_DIFF_CARD, SAMPLE_HELPER, SAMPLE_MEMORY, SAMPLE_MODEL_SWITCH, SAMPLE_SECRET_INPUT, SAMPLE_VAULT_USED } from "../../../ui/src/blocks/impl-b/sample.ts";
import type { Block } from "../../../ui/src/kit/types.ts";

export const title = "Chat blocks, part 2";

interface Turn {
  who: string;
  at: string;
  text: string;
  blocks: Block[];
}

const PARTS: Record<string, Turn[]> = {
  a: [
    { who: "Intake", at: "9:42", text: "Plan approved. I checked the form fields first, and I will remember the slot she prefers.", blocks: [SAMPLE_MODEL_SWITCH, SAMPLE_VAULT_USED, SAMPLE_MEMORY] },
    { who: "Intake", at: "9:44", text: "A helper is checking the bounce list while I draft the letter.", blocks: [SAMPLE_HELPER] },
  ],
  b: [
    { who: "Intake", at: "9:48", text: "I need the Lawmatics key to book the consult. Paste it here; it goes to the Vault and not into this chat.", blocks: [SAMPLE_SECRET_INPUT] },
    { who: "Intake", at: "9:50", text: "Maya asked for access to Clients, and I have a role change ready for the Paralegals.", blocks: [SAMPLE_ACCESS_REQUEST, SAMPLE_DIFF_CARD] },
  ],
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
  const host: BlockHostB = {
    viewerId: "usr_z9y8x7",
    nameOf: (id) => (id === "usr_a1b2c3" ? "Maya" : id === "agt_a1b2c3" ? "Intake" : undefined),
    invoke: (cap, input) => note(`${cap} ${JSON.stringify(cap === "vault.item.put" ? redactSecretInput(input) : input)}`),
    open: (tab, input) => note(`open ${tab} ${JSON.stringify(input)}`),
  };
  // The query is read after mount (rule 25), so the first paint matches on server and client.
  const [which, setWhich] = useState("a");
  useEffect(() => setWhich(part()), []);
  const turns = PARTS[which] ?? [];
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
              <BlockViewB key={b.id} block={b} host={host} />
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
