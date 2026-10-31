// Browse channels: the public channels you are not in, each with Join. A join opens the channel.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TextField } from "../../../../../../ui/src/TextField/index.tsx";
import { LeadGlyph } from "../sidebar/parts.tsx";
import { matchesQuery } from "../sidebar/model.ts";
import type { Channel } from "../sidebar/model.ts";

export interface BrowseChannelsProps {
  channels: readonly Channel[];
  /** Joins a channel; rejects with the Space's error. */
  join(channelId: string): Promise<void>;
  onJoined(channelId: string): void;
  onClose(): void;
  /** Opens the New channel sheet from the empty state. */
  onNew?(): void;
}

const ROW = 34;
const SEARCH_FROM = 7;

export function BrowseChannels({ channels, join, onJoined, onClose, onNew }: BrowseChannelsProps): ReactElement {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const go = (c: Channel): void => {
    setBusy(c.channelId);
    setFailed(null);
    join(c.channelId).then(() => { setBusy(null); onJoined(c.channelId); }, () => { setBusy(null); setFailed(c.channelId); });
  };
  const shown = channels.filter((c) => matchesQuery(q, c.name, c.topic ?? ""));
  const rows: ReactElement[] = [];
  for (const c of shown) {
    rows.push(
      <View key={c.channelId} style={{ height: ROW }}>
        <Row
          id={`browse-${c.channelId}`} title={c.name} {...(failed === c.channelId ? { titleSuffix: "Could not join" } : c.topic ? { titleSuffix: c.topic } : {})}
          leading={<LeadGlyph name="hash" />}
          trailing={
            <Pressable accessibilityRole="button" accessibilityLabel={`Join ${c.name}`} testID={`join-${c.channelId}`} disabled={busy !== null} onPress={() => go(c)} style={({ hovered }: { hovered?: boolean }) => [s.join, hovered === true && s.joinOver, busy === c.channelId && s.dim]}>
              <Text style={s.joinText}>{busy === c.channelId ? "Joining" : "Join"}</Text>
            </Pressable>
          }
        />
      </View>,
    );
  }
  return (
    <Dialog title="Browse channels" onClose={onClose} width={480} fill testID="browse-channels" actions={[{ label: "Done", onPress: onClose, primary: true, testID: "browse-done" }]}>
      {channels.length >= SEARCH_FROM ? <TextField value={q} onChangeText={setQ} placeholder="Search channels" accessibilityLabel="Search channels" testID="browse-search" autoCapitalize="none" autoCorrect={false} /> : null}
      {channels.length === 0 ? (
        <View style={s.none} testID="browse-empty">
          <Text style={s.noneText}>Nothing to join</Text>
          {onNew ? <Pressable accessibilityRole="button" accessibilityLabel="New channel" testID="browse-new" onPress={onNew}><Text style={s.link}>New channel</Text></Pressable> : null}
        </View>
      ) : (
        <ScrollView style={{ maxHeight: ROW * 8 }} testID="browse-list">{rows.length ? rows : <View style={s.none}><Text style={s.noneText}>No match</Text></View>}</ScrollView>
      )}
    </Dialog>
  );
}

const s = StyleSheet.create({
  join: { height: 24, paddingHorizontal: 10, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  joinOver: { opacity: 0.8 },
  joinText: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  dim: { opacity: 0.5 },
  none: { height: ROW * 2, alignItems: "center", justifyContent: "center", gap: 6 },
  noneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
});
