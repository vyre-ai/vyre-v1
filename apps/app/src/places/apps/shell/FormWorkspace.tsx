import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { formPreviewHtml } from "./form-preview.ts";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Button, Field, s } from "./editor-ui.tsx";
export interface FormWorkspaceProps {
  title: string; actions?: ReactNode; back(): void; rail: ReactNode; children: ReactNode;
  fields: readonly { key: string; title: string; type: string }[];
  modes: readonly { field: string; mode: string; prefillKey?: string; step?: number }[];
  css: string; onCss(value: string): void; ask?(): void; consent: string; error?: string | null; offline?: boolean; loading?: boolean; retry?(): void;
}
/** The form canvas is a local preview. It never submits visitor answers or publishes a draft. */
export function FormWorkspace({ title, actions, back, rail, children, fields, modes, consent, css, onCss, ask, error, offline, loading, retry }: FormWorkspaceProps): ReactElement {
  const phone = useWindowDimensions().width < 700;
  const [tab, setTab] = useState("build");
  return <View style={w.root} testID="apps-form-detail">
    <View style={w.toolbar}><Button title="Back to Apps" onPress={back} /><Text numberOfLines={1} accessibilityRole="header" style={w.title}>{title}</Text>
      <View style={w.tabs}><Button title="Build" primary={tab === "build"} onPress={() => setTab("build")} /><Button title="Code" primary={tab === "code"} onPress={() => setTab("code")} /><Button title="Preview" primary={tab === "preview"} onPress={() => setTab("preview")} />{ask ? <Button title="Ask" onPress={ask} /> : null}</View>{actions}
    </View>
    {offline ? <States kind="offline" title="Reconnect to this Space to save or publish." /> : null}
    {error ? <States kind="error" message={error} {...(retry ? { onRetry: retry } : {})} /> : null}
    {loading ? <Text>Loading…</Text> : <View style={w.body}>
      {tab === "code" ? <ScrollView style={[w.rail, phone && w.phoneRail]} contentContainerStyle={{ padding: 16, gap: 12 }}><Text style={s.text}>Custom CSS styles the saved form. Save changes before publishing.</Text><Field label="Custom CSS" value={css} onChange={onCss} multiline /></ScrollView> : null}
      {tab === "build" ? <ScrollView style={[w.rail, phone && w.phoneRail]} contentContainerStyle={w.railContent}>{rail}{children}</ScrollView> : null}
      {!phone || tab === "preview" ? <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} testID="apps-form-canvas">{createElement("iframe", { title: "Form preview", sandbox: "", referrerPolicy: "no-referrer", srcDoc: formPreviewHtml(title, fields, modes, consent, css), style: { border: 0, width: "100%", height: "100%", flex: 1 } })}</View> : null}
    </View>}
  </View>;
}
const w = StyleSheet.create({ root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "var(--win)" as string }, toolbar: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderBottomWidth: 1, borderColor: "var(--line)" as string }, title: { flex: 1, minWidth: 120, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string }, tabs: { flexDirection: "row", gap: 4 }, body: { flex: 1, minHeight: 0, flexDirection: "row" }, rail: { width: 260, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--side)" as string }, phoneRail: { width: "100%", flexGrow: 1, flexShrink: 1, flexBasis: "auto" }, railContent: { paddingBottom: 50 } });
