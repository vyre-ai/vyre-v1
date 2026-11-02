// Artifacts, at the top of Chats: everything a model made to show you, drawn like Tasks and Threads (the same column, title and rows), so the three rows at the top of the sidebar open
// three pages of one family. A row opens the artifact itself, which is the Apps viewer in its own tab (sites.artifact_open makes its address for the person opening it).
import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { useEffect, useState } from "react";
import { LIST_PAGE } from "./ThreadsPage.tsx";

type Artifact = CapMap["sites.list"]["out"]["sites"][number];

const when = (at: number | undefined, now: number): string => {
  if (at === undefined) return "";
  const mins = Math.round((now - at) / 60_000);
  return mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : new Date(at).toLocaleDateString();
};

export function ArtifactsPage({ rt }: { rt: ShellRuntime }): ReactElement {
  const [rows, setRows] = useState<readonly Artifact[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(rt.call("sites.list", { kind: "artifact" })).then((o) => { if (live) setRows((o as CapMap["sites.list"]["out"]).sites); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [rt]);
  const now = Date.now();
  return (
    <ScrollView testID="artifacts-page" style={LIST_PAGE.root} contentContainerStyle={LIST_PAGE.content}>
      <View style={LIST_PAGE.col}>
        <Text accessibilityRole="header" aria-level={1} style={LIST_PAGE.title}>Artifacts</Text>
        <View style={LIST_PAGE.rows}>
          {rows !== null && rows.length === 0 ? <Text testID="artifacts-empty" style={LIST_PAGE.empty}>When an agent makes something to show you, it lands here.</Text> : null}
          {(rows ?? []).map((a) => (
            <Row key={a.siteId} id={`artifact-${a.siteId}`} title={a.name} note={`${a.owner === rt.me.id ? "You" : "Shared with you"}${a.updatedAt !== undefined ? ` · ${when(a.updatedAt, now)}` : ""}`} onPress={() => rt.open({ screen: "apps.artifacts", args: { artifactId: a.siteId } })} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
