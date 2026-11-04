// Artifacts, at the top of Chats: everything a model made to show you, drawn like Tasks and Threads (the same column, title and rows), so the three rows at the top of the sidebar open
// three pages of one family. A row opens the artifact itself, which is the Apps viewer in its own tab (sites.artifact_open makes its address for the person opening it).
import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useContextMenu } from "../../../../../../ui/src/Menu/context.tsx";
import { useShareSheet } from "../../../share/useShareSheet.tsx";
import { artifactMenu } from "../menus/artifact.ts";
import { RenameField } from "../conversation/parts.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { useEffect, useRef, useState } from "react";
import { LIST_PAGE } from "./RepliesPage.tsx";

type Artifact = CapMap["sites.list"]["out"]["sites"][number];

const when = (at: number | undefined, now: number): string => {
  if (at === undefined) return "";
  const mins = Math.round((now - at) / 60_000);
  return mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : new Date(at).toLocaleDateString();
};

export function ArtifactsPage({ rt }: { rt: ShellRuntime }): ReactElement {
  const [rows, setRows] = useState<readonly Artifact[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const cm = useContextMenu();
  const seq = useRef(0);
  const reload = (): void => { void Promise.resolve(rt.call("sites.list", { kind: "artifact" })).then((o) => setRows((o as CapMap["sites.list"]["out"]).sites), () => setRows([])); };
  useEffect(() => {
    let live = true;
    void Promise.resolve(rt.call("sites.list", { kind: "artifact" })).then((o) => { if (live) setRows((o as CapMap["sites.list"]["out"]).sites); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [rt]);
  const share = useShareSheet({ call: (cap, input) => Promise.resolve(rt.call(cap, input)), me: rt.me, nameOf: (id) => (id === rt.me.id ? rt.me.name : id), spaceName: rt.space.name, newKey: () => `art-share-${++seq.current}`, toast: setSaid });
  const fail = (e: unknown): void => setSaid(e instanceof Error ? e.message : "That did not go through.");
  const link = (id: string): string => { const l = (globalThis as { location?: { origin?: string; pathname?: string } }).location; return `${l?.origin ?? ""}${l?.pathname ?? ""}#screen=apps.artifacts&artifactId=${id}`; };
  const copy = (text: string): void => { const c = (globalThis as { navigator?: { clipboard?: { writeText(x: string): unknown } } }).navigator?.clipboard; if (c) void c.writeText(text); };
  const menuOf = (a: Artifact): ReturnType<typeof artifactMenu> => artifactMenu(
    { mine: a.owner === rt.me.id },
    {
      open: () => rt.open({ screen: "apps.artifacts", args: { artifactId: a.siteId } }),
      share: () => share.open({ resourceType: "site", resourceId: a.siteId, itemType: "artifact", name: a.name }),
      copyLink: () => copy(link(a.siteId)),
      rename: () => setRenaming(a.siteId),
      remove: () => setAsking(a.siteId),
    },
  );
  const rename = (a: Artifact, name: string | null): void => {
    setRenaming(null);
    if (name === null) return;
    void Promise.resolve(rt.call("sites.update", { siteId: a.siteId, name })).then(reload, fail);
  };
  const remove = (a: Artifact): void => { setAsking(null); void Promise.resolve(rt.call("sites.delete", { siteId: a.siteId })).then(reload, fail); };
  const now = Date.now();
  const asked = (rows ?? []).find((a) => a.siteId === asking);
  return (
    <ScrollView testID="artifacts-page" style={LIST_PAGE.root} contentContainerStyle={LIST_PAGE.content}>
      <View style={LIST_PAGE.col}>
        <Text accessibilityRole="header" aria-level={1} style={LIST_PAGE.title}>Artifacts</Text>
        <View style={LIST_PAGE.rows}>
          {rows !== null && rows.length === 0 ? <Text testID="artifacts-empty" style={LIST_PAGE.empty}>When an agent makes something to show you, it lands here.</Text> : null}
          {(rows ?? []).map((a) => (renaming === a.siteId ? (
            <View key={a.siteId} style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
              <RenameField value={a.name} label={`Rename ${a.name}`} testID={`artifact-rename-${a.siteId}`} style={{ fontSize: 13, color: "var(--ink)" as string }} onDone={(name) => rename(a, name)} />
            </View>
          ) : (
            <Row key={a.siteId} id={`artifact-${a.siteId}`} title={a.name} note={`${a.owner === rt.me.id ? "You" : "Shared with you"}${a.updatedAt !== undefined ? ` · ${when(a.updatedAt, now)}` : ""}`} onPress={() => rt.open({ screen: "apps.artifacts", args: { artifactId: a.siteId } })} domProps={cm.on(() => menuOf(a), { label: `artifact:${a.siteId}` })} />
          )))}
        </View>
        {asked ? (
          <View testID="artifact-delete-ask" style={{ flexDirection: "row", gap: 14, alignItems: "center", paddingHorizontal: 26, paddingTop: 14 }}>
            <Text style={{ fontSize: 13, color: "var(--ink)" as string }}>{`Delete ${asked.name}? The link stops working.`}</Text>
            <Text accessibilityRole="button" testID="artifact-delete-keep" onPress={() => setAsking(null)} style={{ fontSize: 13, color: "var(--ink-2)" as string }}>Keep it</Text>
            <Text accessibilityRole="button" testID="artifact-delete-yes" onPress={() => remove(asked)} style={{ fontSize: 13, color: "var(--danger)" as string }}>Delete</Text>
          </View>
        ) : null}
        {said ? <Text testID="artifacts-said" accessibilityLiveRegion="polite" onPress={() => setSaid(null)} style={{ fontSize: 12.5, color: "var(--ink-2)" as string, paddingHorizontal: 26, paddingTop: 10 }}>{said}</Text> : null}
      </View>
      {cm.element}
      {share.element}
    </ScrollView>
  );
}
