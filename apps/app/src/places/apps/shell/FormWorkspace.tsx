import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { PreviewOptions } from "./form-preview.ts";
import type { PreviewField } from "./form-design.ts";
import { formPreviewHtml } from "./form-preview.ts";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { Button, s } from "./editor-ui.tsx";
import { FormCode } from "./FormCode.tsx";
export interface FormWorkspaceProps {
  title: string; actions?: ReactNode; back(): void; rail: ReactNode; children: ReactNode;
  fields: readonly PreviewField[]; previewOptions?: PreviewOptions;
  modes: readonly { field: string; mode: string; prefillKey?: string; step?: number }[];
  css: string; onCss(value: string): void; html: string; onHtml(value: string): void; js: string; onJs(value: string): void; /** the inline Ask panel, shown under the source editors; its button here opens the Code tab */ askPanel?: ReactNode; consent: string; error?: string | null; offline?: boolean; loading?: boolean; retry?(): void;
}
/** The form canvas is a local preview. It never submits visitor answers or publishes a draft. */
export function FormWorkspace({ title, actions, back, rail, children, fields, modes, previewOptions, consent, css, onCss, html, onHtml, js, onJs, askPanel, error, offline, loading, retry }: FormWorkspaceProps): ReactElement {
  const phone = useWindowDimensions().width < 700;
  const [tab, setTab] = useState("build");
  const previewHtml = formPreviewHtml(title, fields, modes, consent, css, { ...previewOptions, html, js });
  const asked = modes.filter((m) => m.mode === "ask").flatMap((m) => fields.filter((f) => f.key === m.field));
  return <View style={w.root} testID="apps-form-detail">
    <View style={w.toolbar}><Button title="Back to Apps" onPress={back} /><Text numberOfLines={1} accessibilityRole="header" style={w.title}>{title}</Text>
      <View style={w.tabs}><Button title="Build" primary={tab === "build"} onPress={() => setTab("build")} /><Button title="Code" primary={tab === "code"} onPress={() => setTab("code")} /><Button title="Preview" primary={tab === "preview"} onPress={() => setTab("preview")} />{askPanel ? <Button title="Ask" testID="apps-form-ask-open" onPress={() => setTab("code")} /> : null}</View>{actions}
    </View>
    {offline ? <States kind="offline" title="Reconnect to this Space to save or publish." /> : null}
    {error ? <States kind="error" message={error} {...(retry ? { onRetry: retry } : {})} /> : null}
    {loading ? <Text>Loading…</Text> : <View style={w.body}>
      {tab === "code" ? <ScrollView style={[w.rail, phone && w.phoneRail]} contentContainerStyle={{ padding: 16, gap: 12 }}><FormCode html={html} css={css} js={js} onHtml={onHtml} onCss={onCss} onJs={onJs} asked={asked} disabled={Boolean(offline)} />{askPanel}</ScrollView> : null}
      {tab === "build" ? <ScrollView style={[w.rail, phone && w.phoneRail]} contentContainerStyle={w.railContent}>{rail}{children}</ScrollView> : null}
      {!phone || tab === "preview" ? <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} testID="apps-form-canvas">{createElement("iframe", { key: previewHtml, title: "Form preview", sandbox: js ? "allow-scripts" : "", referrerPolicy: "no-referrer", srcDoc: previewHtml, style: { border: 0, width: "100%", height: "100%", flex: 1 } })}</View> : null}
    </View>}
  </View>;
}
const w = StyleSheet.create({ root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "var(--win)" as string }, toolbar: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderBottomWidth: 1, borderColor: "var(--line)" as string }, title: { flex: 1, minWidth: 120, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string }, tabs: { flexDirection: "row", gap: 4 }, body: { flex: 1, minHeight: 0, flexDirection: "row" }, rail: { width: 260, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--side)" as string }, phoneRail: { width: "100%", flexGrow: 1, flexShrink: 1, flexBasis: "auto" }, railContent: { paddingBottom: 50 } });
