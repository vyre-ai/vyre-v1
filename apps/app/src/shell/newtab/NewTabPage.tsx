// The new-tab page (screen shell.new-tab): one search field, then Start, Chat with, Recent, Record types and Folders while the field is empty. Typing swaps the sections for the
// search results, exactly as the Cmd-K sheet answers. Every control is a button with a hover wash; Recent and Folders are the shared Row.
import type { ReactElement, ReactNode } from "react";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { MenuIcon } from "../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import type { RowProps } from "../../../../../ui/src/Row/props.ts";
import { CmdKBody, KIND_LABEL, Tile, useCmdK, useCmdKState } from "../cmdk/CmdK.tsx";
import type { Hit } from "../cmdk/model.ts";
import type { Platform as KeyPlatform } from "../keyboard/map.ts";
import { START, faceLabel } from "./model.ts";
import type { NewTabData, StartKind } from "./model.ts";

const SVG = (d: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const START_ICON: Record<StartKind, string> = {
  chat: SVG('<path d="M3 4.500a1.500 1.500 0 011.500-1.500h7A1.500 1.500 0 0113 4.500v5a1.500 1.500 0 01-1.500 1.500H7l-3 2.500V11a1.500 1.500 0 01-1-1.400z"/>'),
  agent: SVG('<path d="M8 2.500v3M8 10.500v3M2.500 8h3M10.500 8h3M4.200 4.200l2 2M9.800 9.800l2 2M11.800 4.200l-2 2M6.200 9.800l-2 2"/>'),
  task: SVG('<circle cx="8" cy="8" r="5.500"/><path d="M5.500 8.200l1.700 1.700 3.300-3.600"/>'),
  record: SVG('<ellipse cx="8" cy="4.500" rx="5" ry="2"/><path d="M3 4.500v7c0 1.100 2.200 2 5 2s5-.9 5-2v-7M3 8c0 1.100 2.200 2 5 2s5-.9 5-2"/>'),
  file: SVG('<path d="M4 2.500h5l3 3v8H4z"/><path d="M9 2.500v3h3"/>'),
  folder: SVG('<path d="M2.500 4.500a1 1 0 011-1H6l1.500 1.800h5a1 1 0 011 1v5.200a1 1 0 01-1 1h-9a1 1 0 01-1-1z"/>'),
};
const TYPE_ICON = SVG('<rect x="2.500" y="3" width="11" height="10" rx="1.800"/><path d="M2.500 6.500h11M6.500 6.500v6.500"/>');

function Heading({ children }: { children: string }): ReactElement {
  return <Text style={styles.head} role="heading" aria-level={3}>{children}</Text>;
}

function Tap({ label, onPress, style, children }: { label: string; onPress: () => void; style: object; children: ReactNode }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [style, hovered === true ? { backgroundColor: "var(--hover)" } : null]}>
      {children}
    </Pressable>
  );
}

export function NewTabPage({ data, platform = "mac" }: { data: NewTabData; platform?: KeyPlatform }): ReactElement {
  // Recent is drawn by the page itself, below Start and Chat with; the sheet under the field only answers a typed query.
  const search = useMemo(() => ({ ...data, recent: () => [] }), [data]);
  const ctl = useCmdK(search);
  const state = useCmdKState(ctl);
  const typed = state.raw.trim() !== "";
  return (
    <View testID="newtab-page" style={styles.page}>
      <View style={styles.col}>
        <CmdKBody controller={ctl} platform={platform} inline placeholder="Open anything, or start something" />
        {typed ? null : (
          <View testID="newtab-sections">
            <Heading>Start</Heading>
            <View style={styles.wrap}>
              {/* ui-rows-lint: not a list (six Start tiles in a wrapping grid) */}
              {START.map((s) => (
                <Tap key={s.kind} label={s.label} onPress={() => data.start(s.kind)} style={styles.tile}>
                  {s.kind === "chat" ? <Avatar name="Assistant" kind="agent" size={20} /> : <MenuIcon icon={START_ICON[s.kind]} color="var(--ink-2)" size={18} />}
                  <Text style={styles.tileText}>{s.label}</Text>
                </Tap>
              ))}
            </View>
            <Heading>Chat with</Heading>
            <View style={styles.wrap}>
              {/* ui-rows-lint: not a list (faces in a wrapping grid) */}
              {data.faces().map((h) => (
                <Tap key={`${h.kind}:${h.id}`} label={`${h.kind === "person" ? "Message" : "Chat with"} ${h.title}`} onPress={() => data.open(h, { newTab: false })} style={styles.face}>
                  <Avatar name={h.title} kind={h.kind === "person" ? "person" : "agent"} size={28} />
                  <Text style={styles.faceText} numberOfLines={1}>{faceLabel(h)}</Text>
                </Tap>
              ))}
            </View>
            {data.recent().length ? <Heading>Recent</Heading> : null}
            {data.recent().map((h) => <Row key={`r-${h.kind}:${h.id}`} {...hitRow(h, data)} />)}
            {data.recordTypes().length ? <Heading>Record types</Heading> : null}
            <View style={styles.wrap}>
              {/* ui-rows-lint: not a list (record type chips in a wrapping row) */}
              {data.recordTypes().map((t) => (
                <Tap key={t} label={`Open ${t}`} onPress={() => data.openType(t)} style={styles.type}>
                  <MenuIcon icon={TYPE_ICON} color="var(--ink-3)" size={15} />
                  <Text style={styles.tileText}>{t}</Text>
                </Tap>
              ))}
            </View>
            {data.folders().length ? <Heading>Folders</Heading> : null}
            {data.folders().map((h) => <Row key={`f-${h.id}`} {...hitRow(h, data)} />)}
          </View>
        )}
      </View>
    </View>
  );
}

/** The shared Row's props for one hit: the title, the grey meta after it, the kind at the right. */
function hitRow(hit: Hit, data: NewTabData): RowProps {
  const meta = hit.snippet ?? hit.path;
  return { id: `nt-${hit.kind}-${hit.id}`, title: hit.title, ...(meta ? { titleSuffix: meta } : {}), leading: <Tile hit={hit} />, trailing: <Text style={styles.kind}>{KIND_LABEL.get(hit.kind) ?? ""}</Text>, onPress: () => data.open(hit, { newTab: false }) };
}

const styles = StyleSheet.create({
  page: { flex: 1, width: "100%", alignItems: "center", paddingTop: 56, paddingHorizontal: 16 },
  col: { width: "100%", maxWidth: 680 },
  head: { marginTop: 18, marginBottom: 4, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  tile: { flex: 1, minWidth: 96, maxWidth: 120, height: 56, borderRadius: 10, alignItems: "center", justifyContent: "flex-start", paddingTop: 10, gap: 6 },
  tileText: { fontSize: 12, fontWeight: "500", color: "var(--ink-2)" },
  face: { width: 62, paddingTop: 8, paddingBottom: 6, borderRadius: 10, alignItems: "center", gap: 5 },
  faceText: { fontSize: 11.5, color: "var(--ink-2)" },
  type: { height: 34, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 10, paddingLeft: 10, paddingRight: 12 },
  kind: { fontSize: 11.5, color: "var(--ink-3)" },
});
