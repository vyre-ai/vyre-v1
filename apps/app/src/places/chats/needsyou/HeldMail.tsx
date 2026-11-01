// A held send in Needs you: the draft as it will go out on one side, the record it is about on the other (stacked on a narrow screen). The buttons are the request's own, relabelled Send and Ask for changes.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { peekOf } from "./heldmail.ts";
import type { HeldMail, Peek } from "./heldmail.ts";

const TYPES = ["contact", "company"] as const;

export function HeldMailCard({ mail, call, onOpenRecord }: { mail: HeldMail; call(cap: string, input: unknown): Promise<unknown>; onOpenRecord(recordId: string): void }): ReactElement {
  const wide = useWindowDimensions().width >= 760;
  const [peek, setPeek] = useState<Peek | null>(null);
  useEffect(() => {
    let live = true;
    setPeek(null);
    const id = mail.recordId;
    if (!id) return;
    void (async () => {
      for (const type of TYPES) {
        try {
          const out = (await call("records.get", { type, recordId: id })) as { record?: { type: string; fields: Record<string, unknown> } };
          if (out.record && live) { setPeek(peekOf(out.record)); return; }
        } catch { /* not that kind of record, or not readable: try the next, and show nothing if none answers */ }
      }
    })();
    return () => { live = false; };
  }, [call, mail.recordId]);
  return (
    <View style={[s.wrap, wide && s.wide]} testID="held-mail">
      <View style={s.draft} testID="held-draft">
        <Text style={s.head}>Draft</Text>
        <View style={s.meta}><Text style={s.k}>To</Text><Text style={s.v} testID="held-to">{mail.to.join(", ")}</Text></View>
        {mail.cc.length > 0 ? <View style={s.meta}><Text style={s.k}>Cc</Text><Text style={s.v}>{mail.cc.join(", ")}</Text></View> : null}
        <View style={s.meta}><Text style={s.k}>Subject</Text><Text style={[s.v, s.subject]} testID="held-subject">{mail.subject}</Text></View>
        <Text style={s.body} testID="held-body">{mail.body || "No text."}</Text>
        {mail.attachments > 0 ? <Text style={s.k}>{`${mail.attachments} ${mail.attachments === 1 ? "attachment" : "attachments"}`}</Text> : null}
      </View>
      {mail.recordId ? (
        <View style={s.record} testID="held-record">
          <Text style={s.head}>About</Text>
          {peek === null ? <Text style={s.k}>{" "}</Text> : (
            <Pressable accessibilityRole="link" accessibilityLabel={`${peek.title}, ${peek.type}`} onPress={() => onOpenRecord(mail.recordId!)} testID="held-record-open">
              <Text style={s.rtitle}>{peek.title}</Text>
              <Text style={s.k}>{peek.type}</Text>
            </Pressable>
          )}
          {peek?.lines.map(([k, v]) => <View key={k} style={s.meta}><Text style={s.k}>{k}</Text><Text style={s.v}>{v}</Text></View>)}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12, marginVertical: 8 },
  wide: { flexDirection: "row", alignItems: "flex-start" },
  draft: { flex: 1.6, gap: 6, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string },
  record: { flex: 1, gap: 6, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string },
  head: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, color: "var(--ink-3)" as string },
  meta: { flexDirection: "row", gap: 10 },
  k: { width: 56, fontSize: 12.5, color: "var(--ink-3)" as string },
  v: { flex: 1, fontSize: 13.5, color: "var(--ink)" as string },
  subject: { fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 21, color: "var(--ink)" as string, marginTop: 6 },
  rtitle: { fontSize: 15, fontWeight: "600", color: "var(--accent)" as string },
});
