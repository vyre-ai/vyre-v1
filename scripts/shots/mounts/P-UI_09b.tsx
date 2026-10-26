// Mount for P-UI_09b: the shared Row with a lead-in before its note (Draft ready in the accent, Unsure match in the warning colour) and marks after the title (star, bell), over the Inbox's tall rows.
// The prototype side is its Inbox list in the same skin: the same rows the Inbox screen draws with these props.
import { createElement } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Avatar } from "../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../ui/src/Row/index.tsx";

export const title = "Row lead-in and marks";

const star = createElement("span", { "aria-hidden": true, style: { color: "var(--accent)", fontSize: 12, lineHeight: "18px" } }, "★");
const bell = createElement("span", { "aria-hidden": true, style: { color: "var(--ink-3)", fontSize: 12, lineHeight: "18px" } }, "♪");
const face = (name: string): ReactNode => <Avatar name={name} kind="person" size={28} />;

export default function Mount(): ReactNode {
  return (
    <View testID="rows" style={{ width: "100%", maxWidth: 420, paddingTop: 8, backgroundColor: "var(--win)" as string }}>
      <Row id="r1" tall emphasis title="Elena Rivera" titleSuffix="Rivera Holdings" titleMarks={<>{star}{bell}</>} noteLead="Draft ready" note="Hi Elena, thanks for draft 3. I will read it tonight and reply by Friday." leading={face("Elena Rivera")} trailing={<span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>10:15 AM</span> as never} onPress={() => undefined} />
      <Row id="r2" tall title="+1 628 555 0194" noteLead="Unsure match" noteLeadTone="warning" note="Hi, is this the Northwind office? I got a missed call from this number." leading={face("Unknown")} trailing={<span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>10:05 AM</span> as never} onPress={() => undefined} />
      <Row id="r3" tall title="Marcus Pruitt" titleSuffix="Pruitt & Co." titleMarks={star} note="Can you resend invoice 1041? I can't find it." leading={face("Marcus Pruitt")} trailing={<span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Yesterday</span> as never} onPress={() => undefined} />
      <Row id="r4" tall selected title="Priya Nair" noteLead="Waiting on you" note="Signed pages are attached. Please countersign when you can." leading={face("Priya Nair")} trailing={<span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Mon</span> as never} onPress={() => undefined} />
    </View>
  );
}
