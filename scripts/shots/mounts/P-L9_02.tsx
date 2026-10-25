// Mount for P-L9_02: 10,000 ui/Row items in ui/VirtualList, one selected and one hovered, as in a Files list.
import { View } from "react-native";
import { Row } from "../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../ui/src/VirtualList/index.tsx";

export const title = "Row list";

const NAMES = ["Weekly sync", "Launch checklist", "Inbox review", "Handbook", "Q4 plan", "Intake script", "Brand kit", "Retainer template"];
const rows = Array.from({ length: 10000 }, (_, i) => ({ id: `r${i}`, title: `${NAMES[i % NAMES.length]} ${i + 1}` }));

export default function Mount() {
  return (
    <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 8 }}>
      <VirtualList
        data={rows}
        rowHeight={28}
        keyOf={(r) => r.id}
        renderItem={(r) => <Row id={r.id} title={r.title} selected={r.id === "r1"} hovered={r.id === "r3"} />}
      />
    </View>
  );
}
