// Vault item list: a calm list in the shared ui/VirtualList of ui/Row. Logo, name, one second line (field names, never values, or how a provider signs in) and "Used 14 min ago" in
// quiet grey. A small dot marks a row worth a look. Click selects, a second click or Enter edits, right-click and the Menu key open the row's menu.
import { useRef } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { needsLook, secondLine, usedLabel } from "./model.ts";
import type { Clock, Item, Provider } from "./model.ts";
import { LogoTile } from "./parts.tsx";

export const LIST_ROW_HEIGHT = 44;
const DOUBLE_MS = 450;

export interface ItemListProps {
  items: readonly Item[];
  selectedId: string | null;
  providerOf: ReadonlyMap<string, Provider>;
  healthIds: ReadonlySet<string>;
  clock: Clock;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (item: Item, x: number, y: number) => void;
}

export function ItemList({ items, selectedId, providerOf, healthIds, clock, onSelect, onOpen, onMenu }: ItemListProps): ReactElement {
  const last = useRef<{ id: string; at: number } | null>(null);
  const press = (id: string): void => {
    const now = Date.now();
    const again = last.current && last.current.id === id && now - last.current.at < DOUBLE_MS;
    last.current = { id, at: now };
    if (again) onOpen(id); else onSelect(id);
  };
  const line = (item: Item): ReactElement => {
    const provider = providerOf.get(item.id);
    const look = needsLook(item, clock, healthIds);
    return (
      <View {...menuTrigger((x, y) => onMenu(item, x, y))} style={s.rowWrap}>
        <Row
          id={item.id}
          title={item.name}
          note={secondLine(item, provider)}
          selected={item.id === selectedId}
          leading={<View style={s.logo}><LogoTile name={item.name} size={30} /></View>}
          trailing={<View style={s.trail}>{look ? <View style={s.dot} testID={`look-${item.id}`} accessibilityLabel="Worth a look" /> : null}<Text style={s.used}>{usedLabel(item.lastUsedAt, clock)}</Text></View>}
          onPress={() => press(item.id)}
        />
      </View>
    );
  };
  return (
    <View style={s.list} testID="vault-list">
      <VirtualList
        data={items}
        rowHeight={LIST_ROW_HEIGHT}
        keyOf={(it) => it.id}
        renderItem={(it) => line(it as Item)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  list: { flex: 1, paddingHorizontal: 8 },
  rowWrap: { width: "100%" },
  logo: { marginRight: 10 },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 99, backgroundColor: "var(--warn)" as string },
  used: { fontSize: 12, color: "var(--ink-3)" as string },
});
