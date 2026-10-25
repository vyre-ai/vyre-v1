// Vault health (spec 2.17): one line that says how many items are weak, reused, stale or due, then one row per item with what is wrong in words. Clicking a row opens the item to fix it;
// the row's own menu button is the place's. Values never come here: the list is the health check's findings, by name.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { Health } from "../layout/model.ts";
import { LogoTile } from "../layout/parts.tsx";
import { issueLine, summaryWords, worstFirst } from "./model.ts";

export const HEALTH_ROW_HEIGHT = 44;

export interface HealthViewProps {
  health: Health;
  selectedId: string | null;
  onSelect(itemId: string): void;
}

export function HealthView({ health, selectedId, onSelect }: HealthViewProps): ReactElement {
  const items = worstFirst(health.items);
  return (
    <View style={s.frame} testID="vault-health">
      <Text style={s.summary} testID="health-summary" accessibilityRole="summary">{`${summaryWords(health)} · ${health.total} checked`}</Text>
      {items.length === 0 ? <Text style={s.clear} testID="health-clear">Nothing needs attention.</Text> : (
        <VirtualList
          data={items}
          rowHeight={HEALTH_ROW_HEIGHT}
          keyOf={(it) => (it as Health["items"][number]).itemId}
          renderItem={(raw) => {
            const it = raw as Health["items"][number];
            return (
              <Row id={`health:${it.itemId}`} title={it.name} note={issueLine(it.issues)} selected={it.itemId === selectedId} leading={<View style={s.logo}><LogoTile name={it.name} size={30} /></View>}
                trailing={<View style={s.dot} accessibilityLabel="Worth a look" />} onPress={() => onSelect(it.itemId)} />
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, paddingHorizontal: 8 },
  summary: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 10, paddingBottom: 8 },
  clear: { fontSize: 13, color: "var(--ink-3)" as string, paddingHorizontal: 10, paddingTop: 12 },
  logo: { marginRight: 10 },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: "var(--warn)" as string },
});
