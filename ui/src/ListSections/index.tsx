// ui/ListSections: Personal, Shared with me, Space, in that order, every row a ui/Row (ARCH 4.12, spec 2.4).
// A section with no rows is still present; the header stays so the order never changes.

import { StyleSheet, Text, View } from "react-native";
import { Row } from "../Row/index.tsx";
import { sectionsInOrder } from "./props.ts";
import type { ListSectionsProps, ListRow, ListSection } from "./props.ts";

export type { ListSectionsProps } from "./props.ts";

export interface ListSectionsHandlers {
  selectedId?: string;
  onOpen?: (row: ListRow) => void;
}

function Section({ section, selectedId, onOpen }: { section: ListSection } & ListSectionsHandlers) {
  return (
    <View testID={`section-${section.name}`} accessibilityRole="list" accessibilityLabel={section.name}>
      <Text accessibilityRole="header" style={styles.head}>{section.name}</Text>
      {section.rows.map((r) => (
        <Row key={r.id} id={r.id} title={r.title} note={r.note} selected={r.id === selectedId} onPress={onOpen ? () => onOpen(r) : undefined} />
      ))}
    </View>
  );
}

export function ListSections({ type, sections, selectedId, onOpen }: ListSectionsProps & ListSectionsHandlers) {
  const parts = [];
  for (const section of sectionsInOrder(sections)) parts.push(<Section key={section.name} section={section} selectedId={selectedId} onOpen={onOpen} />);
  return (
    <View testID={`list-${type}`} accessibilityLabel={type} style={styles.list}>
      {parts}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { width: "100%", paddingHorizontal: 6, gap: 8 },
  head: { color: "var(--ink-3)" as string, fontSize: 11.5, fontWeight: "600", height: 24, paddingHorizontal: 8, lineHeight: 24 },
});
