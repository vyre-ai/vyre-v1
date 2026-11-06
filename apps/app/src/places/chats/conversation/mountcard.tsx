// The Mount card in a chat (rc.8 live folders): see mountcard.ts for the protocol. Pick a source, the mount sheet opens at that source (connect there if it is not connected), and once the folder is
// mounted it is shared with the chat's agents and the agent's question is answered. The card then collapses to one line.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import type { ConversationData } from "./data.tsx";
import { shareWithAgents } from "./dropshare.ts";
import { collect } from "./model.ts";
import { mountedAnswer } from "./mountcard.ts";
import type { SourceOffer } from "./mountcard.ts";
import { Card, CardActions, CardDone, CardHead } from "../../../../../../ui/src/Card/index.tsx";

export interface MountCardProps {
  id: string;
  prompt: string;
  offers: readonly SourceOffer[];
  agents: readonly { id: string; name: string }[];
  data: Pick<ConversationData, "call" | "mountSheet">;
  /** Answer the agent's question: the card's words go back as its answer. */
  answer(blockId: string, answer: unknown): void;
}

export function MountCard({ id, prompt, offers, agents, data, answer }: MountCardProps): ReactElement {
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  if (done !== null) return <CardDone testID={`mount-card-done-${id}`} text={done} />;
  const mounted = (info: { folderId: string; name: string }): void => {
    setOpen(null);
    void shareWithAgents(data, [{ type: "folder", id: info.folderId }], agents, `mount-card:${id}`).then(
      () => { setDone(`Mounted ${info.name}`); answer(id, mountedAnswer(info.name, info.folderId)); },
      () => { setDone(`Mounted ${info.name}. Not shared: drag it here.`); },
    );
  };
  return (
    <Card kind="decision" testID={`mount-card-${id}`} label={prompt} onCancel={() => { setDone("Skipped"); answer(id, "Not now. Carry on without it."); }}>
      <CardHead title={prompt} />
      <View style={st.sources}>
        {collect(offers, (o) => (
          <Pressable key={o.source} accessibilityRole="button" accessibilityLabel={`Connect ${o.label}`} testID={`mount-card-source-${id}-${o.source}`} onPress={() => { setLine(null); setOpen(o.source); }} style={({ hovered }: { hovered?: boolean }) => [st.source, hovered === true && st.sourceOver]}>
            {o.brand ? <AppIcon brand={o.brand} size={22} name={o.label} /> : null}
            <Text style={st.sourceText}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <CardActions secondary={[{ label: "Not now", onPress: () => { setDone("Skipped"); answer(id, "Not now. Carry on without it."); }, testID: `mount-card-skip-${id}` }]} error={line} />
      {open !== null && data.mountSheet ? data.mountSheet({ source: open, onMounted: mounted, onClose: () => setOpen(null) }) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  sources: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  source: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string },
  sourceOver: { backgroundColor: "var(--hover)" as string },
  sourceText: { fontSize: 13.5, color: "var(--ink)" as string },
});
