// The Details tab of a reply, on the right (owner, 3 Nov 2026): opened from Details in the message menu or from the hover card. One tab: opening another reply's Details shows that reply in it.
// Top to bottom: the ids with copy, who and where, timing, tokens, cost, tools used, what the agent knew (it was "Show what the agent knew here" in the menu), skills, files, errors and retries.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PaneList, LeadIcon, TextButton, Tool } from "../rightpane/parts.tsx";
import type { Entry } from "../rightpane/parts.tsx";
import { Face } from "../needsyou/parts.tsx";
import { detailLines } from "./model.ts";
import type { Line } from "./model.ts";
import { contextOf } from "./ReplyCard.tsx";
import type { ReplyDetailsActions } from "./ReplyCard.tsx";
import { peekReplyDetails } from "./read.ts";
import type { ReadDetails } from "./read.ts";

export interface ReplyDetailsPaneProps {
  messageId: string;
  details: ReplyDetailsActions;
  copy(text: string, what: string): void;
  /** A file the turn read or wrote opens beside the chat. Left out where it cannot. */
  openFile?(path: string): void;
  /** When the reply was written, as the conversation shows it. */
  when?: string;
}

function entryOf(l: Line, p: ReplyDetailsPaneProps): Entry {
  switch (l.kind) {
    case "label": return { key: l.key, type: "label", text: l.text, ...(l.right ? { right: l.right } : {}) };
    case "note": return { key: l.key, type: "block", node: <Text key={l.key} testID={`details-${l.key}`} style={st.note}>{l.text}</Text> };
    case "kv": {
      const copy = l.copy;
      // a long value with whose it is (Paid by) wraps under its label, so the label never shrinks to "P…" on a phone
      if (l.note) return { key: l.key, type: "block", node: (
        <View key={l.key} testID={`details-${l.key}`} style={st.stack}>
          <Text style={st.stackLabel}>{l.label}</Text>
          <Text style={st.stackValue}>{l.value}<Text style={st.muted}>{` \u00b7 ${l.note}`}</Text></Text>
        </View>
      ) };
      return {
        key: l.key, type: "row", title: l.label, testID: `details-${l.key}`,
        trailing: (
          <View style={st.trail}>
            <Text numberOfLines={l.note ? 2 : 1} style={[st.value, l.muted ? st.muted : null, copy ? st.mono : null]}>{l.value}{l.note ? <Text style={st.muted}>{` \u00b7 ${l.note}`}</Text> : null}</Text>
            {copy ? <Tool icon="copy" label={`Copy the ${copy} id`} testID={`details-copy-${l.key}`} onPress={() => p.copy(l.value, `${copy} id`)} /> : null}
          </View>
        ),
      };
    }
    case "item": {
      const open = l.open !== undefined && p.openFile ? l.open : undefined;
      return {
        key: l.key, type: "row", title: l.title, testID: `details-${l.key}`, leading: <LeadIcon name={l.icon} />,
        ...(l.note ? { note: l.note } : {}), ...(l.right ? { trailing: <Text style={st.value}>{l.right}</Text> } : {}),
        ...(open !== undefined ? { onPress: () => p.openFile!(open) } : {}),
      };
    }
  }
}

export function ReplyDetailsPane(p: ReplyDetailsPaneProps): ReactElement {
  const [read, setRead] = useState<{ status: "loading" } | { status: "ready"; r: ReadDetails } | { status: "failed" }>(() => { const r = peekReplyDetails(p.messageId); return r ? { status: "ready", r } : { status: "loading" }; });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    if (tries > 0 || !peekReplyDetails(p.messageId)) setRead({ status: "loading" });
    p.details.read(p.messageId).then((r) => { if (live) setRead({ status: "ready", r }); }, () => { if (live) setRead({ status: "failed" }); });
    return () => { live = false; };
  }, [p.messageId, tries]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (read.status !== "ready") {
    return (
      <View testID="reply-details" style={st.wait}>
        <Text style={st.note}>{read.status === "loading" ? "Loading" : "The details could not be read just now."}</Text>
        {read.status === "failed" ? <TextButton label="Try again" testID="reply-details-retry" onPress={() => setTries((n) => n + 1)} /> : null}
      </View>
    );
  }
  const d = read.r.details;
  const name = p.details.nameOf(d.agentId);
  const head: Entry = {
    key: "head", type: "block",
    node: (
      <View key="head" style={st.head}>
        <Face name={name} seedId={d.agentId} kind="agent" size={32} />
        <View style={st.headText}>
          <Text numberOfLines={1} style={st.name}>{name}</Text>
          {p.when ? <Text numberOfLines={1} style={st.sub}>{`Reply at ${p.when}`}</Text> : null}
        </View>
      </View>
    ),
  };
  const foot: Entry = { key: "foot", type: "block", node: <View key="foot" style={st.foot}><TextButton label="Copy as JSON" testID="reply-details-json" onPress={() => p.copy(JSON.stringify(d, null, 2), "details")} /></View> };
  return <PaneList testID="reply-details" plain entries={[head, ...detailLines(d, contextOf(p.details, read.r)).map((l) => entryOf(l, p)), foot]} />;
}

const st = StyleSheet.create({
  wait: { padding: 14, gap: 8, alignItems: "flex-start" },
  head: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  headText: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  trail: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 240, flexShrink: 1 },
  value: { fontSize: 13, color: "var(--ink)" as string, textAlign: "right" },
  muted: { color: "var(--ink-4)" as string },
  stack: { paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  stackLabel: { fontSize: 13, color: "var(--ink)" as string },
  stackValue: { fontSize: 13, color: "var(--ink-2)" as string },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "var(--ink-2)" as string },
  note: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, paddingHorizontal: 12, paddingVertical: 6 },
  foot: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 14, alignItems: "flex-start" },
});
