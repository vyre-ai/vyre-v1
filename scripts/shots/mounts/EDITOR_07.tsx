// Mount for l-editor: the chat composer as the Chats place draws it (model strip, effort, the memory lock, Send), in a column of a given width (?pane=700, or the whole window), with a state:
// empty, long draft, chips (a folder and an attachment, a mention), or a reply-to header. The query is read after mount (rule 25).
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Composer } from "../../../ui/src/Composer/index.tsx";
import { MemorySwitch } from "../../../apps/app/src/places/chats/conversation/memory-switch.tsx";

export const title = "Composer layout";

const LONG = "Please read the Rivera engagement letter and compare clause 4 with the fee agreement we sent in March, then tell me which of the two the client signed, and whether the retainer in the second one still matches what @Aliza agreed with Priya last week. If they differ, draft a short note to Omar that explains the difference in plain words.";

export default function Mount() {
  const [q, setQ] = useState<{ pane: string; state: string } | null>(null);
  useEffect(() => { const p = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""); setQ({ pane: p.get("pane") ?? "", state: p.get("state") ?? "empty" }); }, []);
  if (q === null) return <View style={{ flex: 1 }} />;
  const st = q.state;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
      <View style={{ width: q.pane ? Number(q.pane) : "100%", maxWidth: 708 + 48, paddingHorizontal: 24, paddingBottom: 16 }} testID="pane">
        <Composer
          testID="composer" whoWillAnswer="Assistant will reply" lead="Assistant" label="Message" placeholder="Message Assistant..." lists={{ agents: ["Assistant", "Aliza"], people: ["Priya Raman"] }}
          agents={[{ id: "a1", name: "Assistant", kind: "assistant", modelTitle: st === "strip" ? "Claude Sonnet 5.5" : "Auto", effort: "medium", provider: "claude_code", ...(st === "strip" ? { accountName: "Irfad personal", context: { used: 140000, window: 200000 } } : {}) }]}
          mode="ask" onMode={() => undefined} renderPanel={() => <Text>Model</Text>}
          {...(st === "long" || st === "chips" ? { value: LONG } : {})}
          {...(st === "chips" ? { folder: "Clients / Rivera", attachments: [{ name: "Engagement letter.pdf", size: 120400 }] } : {})}
          {...(st === "reply" ? { banner: <Text style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Replying to Priya Raman: "Can you check the retainer?"</Text> } : {})}
          barExtra={<MemorySwitch threadId="t1" call={async () => ({ remember: true })} say={() => undefined} />}
          onSubmit={() => undefined}
        />
      </View>
    </View>
  );
}
