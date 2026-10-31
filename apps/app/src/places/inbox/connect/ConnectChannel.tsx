// Inbox > Connect a channel: what the Inbox shows until one mailbox or number can send. Four tiles, each the door to a flow that already exists (mail connections for Gmail, Outlook
// and IMAP; the Vault's Twilio form for texts and calls). The same choice answers the pencil, the plus and the Dialer while nothing is connected.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StateTile } from "../../../../../../ui/src/States/index.tsx";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { CONNECT_TILES } from "../sidebar/model.ts";
import type { ConnectTile } from "../sidebar/model.ts";
import { useInboxData } from "../sidebar/data.tsx";
import { Glyph } from "../sidebar/parts.tsx";

function Mark({ tile }: { tile: ConnectTile }): ReactElement {
  if (tile.kind === "imap") return <View style={s.mail}><Glyph name="mail" size={16} color="var(--ink-2)" /></View>;
  return <AppIcon brand={tile.brand} size={32} name={tile.label} />;
}

export function ConnectChannel({ onPick }: { onPick?: (tile: ConnectTile) => void }): ReactElement {
  const data = useInboxData();
  const pick = (tile: ConnectTile): void => { data.nav.connect(tile.kind); onPick?.(tile); };
  return (
    <View style={s.wrap} testID="inbox-connect-channel" accessibilityLabel="Connect a channel">
      <StateTile name="inbox" />
      <Text accessibilityRole="header" aria-level={2} style={s.title}>Connect a channel</Text>
      <View style={s.grid}>
        {/* ui-rows-lint: not a list (channel tiles laid out in a wrapping grid) */}
        {CONNECT_TILES.map((tile) => (
          <Pressable
            key={tile.kind} accessibilityRole="button" accessibilityLabel={`${tile.label}, ${tile.hint}`} testID={`connect-${tile.kind}`}
            onPress={() => pick(tile)}
            style={({ hovered }: { hovered?: boolean }) => [s.tile, hovered === true && s.tileOver]}
          >
            <Mark tile={tile} />
            <View style={s.words}>
              <Text style={s.label}>{tile.label}</Text>
              <Text style={s.hint}>{tile.hint}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  title: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, maxWidth: 520 },
  tile: { flexDirection: "row", alignItems: "center", gap: 10, width: 240, minHeight: 56, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  tileOver: { backgroundColor: "var(--hover)" as string, borderColor: "var(--accent-line)" as string },
  mail: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  words: { flex: 1, minWidth: 0 },
  label: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
});
