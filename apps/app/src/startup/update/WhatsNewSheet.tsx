// "What's new in Vyre": one sheet, once per version, on the first open after an update; and again whenever the person asks for it in Settings, About Vyre. The lines are the release's own
// (whats-new.json, written for people at release time), each with the spark in front, and one Continue.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { markSeen, whatsNewToShow } from "./model.ts";
import type { Store, WhatsNew } from "./model.ts";
import { loadWhatsNew, localStore } from "./store.ts";

export function WhatsNewSheet({ notes, onClose }: { notes: WhatsNew; onClose(): void }): ReactElement {
  // a few plain lines of copy, not rows: nothing on them is pressed or picked
  const lines: ReactElement[] = [];
  notes.lines.forEach((line, i) => lines.push(<View key={i} style={s.row}><View style={s.spark} /><Text style={s.line}>{line}</Text></View>));
  return (
    <Dialog title="What's new in Vyre" testID="whats-new" titleTestID="whats-new-title" width={420} onClose={onClose} actions={[{ label: "Continue", primary: true, onPress: onClose, testID: "whats-new-continue" }]}>
      <Text testID="whats-new-version" style={s.version}>{`Version ${notes.version}`}</Text>
      <View testID="whats-new-lines" style={s.lines}>
        {lines}
      </View>
    </Dialog>
  );
}

/** Shows the sheet on the first open after an update, once. Draws nothing otherwise. */
export function WhatsNewOnce(props: { store?: Store | null; load?: () => Promise<WhatsNew | null> }): ReactElement | null {
  const [store] = useState(() => (props.store === undefined ? localStore() : props.store));
  const [load] = useState(() => props.load ?? loadWhatsNew);
  const [show, setShow] = useState<WhatsNew | null>(null);
  useEffect(() => {
    let on = true;
    void load().then((n) => { if (on) setShow(whatsNewToShow(store, n)); });
    return () => { on = false; };
  }, [store, load]);
  if (!show) return null;
  return <WhatsNewSheet notes={show} onClose={() => { markSeen(store, show.version); setShow(null); }} />;
}

const s = StyleSheet.create({
  version: { marginTop: -6, fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  lines: { gap: 12, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  spark: { width: 7, height: 7, borderRadius: 4, marginTop: 7, backgroundColor: "var(--beacon)" as string },
  line: { flex: 1, fontSize: 14, lineHeight: 21, color: "var(--ink)" as string },
});
