// Artifacts: everything a model made to show, that you can see. A quiet list; a row opens in the app in a sandboxed frame, or in the browser, and shares through the same sheet as Files. The address is made for the person
// asking when they open it (sites.artifact_open), so a link never outlives their access.
import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import { errorMessage } from "./mutations.ts";
import { Button, Card, Frame, s as ui, useOnline, useRead } from "./editor-ui.tsx";

type Artifact = CapMap["sites.list"]["out"]["sites"][number];
let seq = 0;

const when = (at: number | undefined, now: number): string => {
  if (at === undefined) return "";
  const mins = Math.round((now - at) / 60_000);
  return mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : new Date(at).toLocaleDateString();
};

/** The whole address of an opened artifact: its public origin when the Space has one, else this app's own gateway. */
export const artifactAddress = (open: { path: string; url?: string | undefined }, base: string | undefined, embed = false): string => {
  const at = open.url ?? `${(base ?? "").replace(/\/+$/, "")}${open.path}`;
  // a one-time code for the artifact host (/x/<code>): framed in the app, its cookie is partitioned to the app (the host's CSP lets only the app frame it)
  return embed && /\/x\/[0-9a-f]{48}$/.test(at) ? `${at}?embed=1` : at;
};

export function ArtifactsList({ back }: { back(): void }): ReactElement {
  const d = useAppsData();
  const list = useRead<CapMap["sites.list"]["out"]>("sites.list", { kind: "artifact" }, "sites");
  const rows = list.data?.sites ?? [];
  return <Frame testID="artifacts-list" title="Artifacts" backTitle="Back to Chats" back={back} error={list.error} loading={list.loading} retry={list.refresh}>
    {rows.length === 0 ? <View testID="artifacts-empty"><States kind="empty" title="Nothing made yet" subtitle="When an agent makes something to show you, it lands here." icon="doc" /></View> : rows.map((a: Artifact) => (
      <Row key={a.siteId} id={a.siteId} title={a.name} note={`${a.owner === d.me?.id ? "You" : "Shared with you"} · ${when(a.updatedAt, d.clock().now)}`} onPress={() => d.nav.open("artifacts", a.siteId)} />
    ))}
  </Frame>;
}

export function ArtifactView({ id, back }: { id: string; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const site = useRead<CapMap["sites.get"]["out"]>("sites.get", { siteId: id }, "sites");
  const [src, setSrc] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [sharing, setSharing] = useState(false), [sure, setSure] = useState(false);
  useEffect(() => {
    let live = true;
    void d.call("sites.artifact_open", { artifactId: id, idempotencyKey: `open-${id}-${d.clock().now}-${++seq}` }).then((o) => { if (live) setSrc(artifactAddress(o as { path: string; url?: string }, d.baseUrl, true)); }, (e: unknown) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [d, id]);
  const name = site.data?.site.name ?? "Artifact";
  const remove = (): void => { void d.call("sites.delete", { siteId: id }).then(back, (e: unknown) => setError(errorMessage(e))); };
  return <Frame testID="artifact-view" title={name} backTitle="Back to Artifacts" back={back} offline={!online} error={error ?? site.error} loading={site.loading} retry={site.refresh}>
    <View style={ui.actions}>
      {src ? <Button title="Open in browser" testID="artifact-browser" onPress={() => { void d.call("sites.artifact_open", { artifactId: id, idempotencyKey: `browser-${id}-${d.clock().now}-${++seq}` }).then((o) => d.nav.openUrl?.(artifactAddress(o as { path: string; url?: string }, d.baseUrl)), (e: unknown) => setError(errorMessage(e))); }} /> : null}
      {d.renderShare ? <Button title="Share" testID="artifact-share" onPress={() => setSharing(true)} /> : null}
      {sure ? <><Text style={ui.text}>{`Delete ${name}? The link stops working.`}</Text><Button title="Keep it" onPress={() => setSure(false)} /><Button title="Delete" testID="artifact-delete-yes" onPress={remove} /></> : <Button title="Delete" testID="artifact-delete" onPress={() => setSure(true)} />}
    </View>
    {src ? createElement("iframe", { src, title: name, sandbox: "allow-scripts allow-forms allow-popups allow-downloads", referrerPolicy: "no-referrer", style: { width: "100%", height: "70vh", border: 0, borderRadius: 10, background: "#fff" }, "data-testid": "artifact-frame" }) : null}
    {!src && !error ? <Card title="Opening"><Text style={ui.text}>{name}</Text></Card> : null}
    {sharing && d.renderShare ? d.renderShare({ type: "site", id, name }, () => setSharing(false)) : null}
  </Frame>;
}
