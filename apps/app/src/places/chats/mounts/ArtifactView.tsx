// One artifact in its own tab, inside Chats (the sidebar stays). One header row (back, the name with one quiet line, Share, "..."), then the page fills the rest edge to edge, with a loading
// state and a real error. The address is made for the person opening it (sites.artifact_open), so a link never outlives their access.
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { subline } from "../../../../../../ui/src/ArtifactCard/index.tsx";
import type { ArtifactInfo } from "../../../../../../ui/src/ArtifactCard/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { FolderShareSheet } from "../../../shell/providers/files-share.tsx";
import { nameLookup } from "../../../shell/providers/records-live.ts";
import { artifactAddress, plainLink } from "./artifact-address.ts";
import { available, DesktopArtifactFrame } from "./desktop-frame.tsx";

type Site = CapMap["sites.get"]["out"]["site"];
let seq = 0;
/** How long a page may take to say it loaded before the tab says it could not. */
export const LOAD_LIMIT_MS = 20_000;

/** Which frame draws the page: the desktop app opens it as a native page over a placeholder (an iframe of the artifact host never keeps its cookie there); a browser keeps the iframe. */
export const frameFor = (src: string | null, desktop: boolean): "none" | "desktop" | "iframe" => (src === null ? "none" : desktop ? "desktop" : "iframe");

/** A native page draws above everything, so it steps aside while a menu, the Share sheet or the delete question is open. */
export const coveredBy = (o: { sharing: boolean; menu: boolean; sure: boolean }): boolean => o.sharing || o.menu || o.sure;

/** The server said this person may not open it (as against it being slow or broken). */
export const refused = (e: unknown): boolean => {
  const code = (e as { error?: { code?: string }; code?: string } | null)?.error?.code ?? (e as { code?: string } | null)?.code;
  return typeof code === "string" && code.startsWith("permission.");
};

const msg = (e: unknown): string => {
  const x = e as { error?: { message?: string }; message?: string } | null;
  return x?.error?.message ?? x?.message ?? "This page couldn’t load here.";
};

/** An artifact row as the card reads it: its picture, the chat that made it, and the people it is shared with by name. */
export const infoOf = (s: Site, nameOf: (id: string) => string = (id) => id): ArtifactInfo => ({
  id: s.siteId, name: s.name, owner: s.owner, access: s.access, updatedAt: s.updatedAt, thumb: s.thumb,
  from: s.chatId !== undefined && s.chatTitle !== undefined ? { id: s.chatId, title: s.chatTitle } : undefined,
  sharedWith: s.sharedWith?.map(nameOf), audience: s.sharedAudience,
});

export function ArtifactView({ rt, artifactId, share, back, gone }: { rt: ShellRuntime; artifactId: string; share: boolean; back(): void; /** the artifact was deleted: leave this tab */ gone(): void }): ReactElement {
  const [site, setSite] = useState<Site | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(share);
  const [attempt, setAttempt] = useState(0);
  const [denied, setDenied] = useState(false);
  const [asked, setAsked] = useState(false);
  const { element, show } = useMenu();
  const nameOf = useMemo(() => nameLookup(rt), [rt]);
  const desktop = available();
  const open = useCallback((embed: boolean): Promise<string> => Promise.resolve(rt.call("sites.artifact_open", { artifactId, idempotencyKey: `open-${artifactId}-${rt.clock().now}-${++seq}` })).then((o) => artifactAddress(o as { path: string; url?: string }, rt.baseUrl, embed)), [rt, artifactId]);
  useEffect(() => {
    let live = true;
    setLoaded(false); setFailed(null); setSrc(null); setDenied(false);
    void Promise.resolve(rt.call("sites.get", { siteId: artifactId })).then((o) => { if (live) setSite((o as CapMap["sites.get"]["out"]).site); }, () => undefined);
    void open(!desktop).then((u) => { if (live) { setSrc(u); if (desktop) setLoaded(true); } }, (e: unknown) => { if (live) { if (refused(e)) setDenied(true); else setFailed(msg(e)); } });
    return () => { live = false; };
  }, [rt, artifactId, open, attempt, desktop]);
  // a page that never says it loaded is an error too, not a spinner for ever
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (src === null || loaded || failed !== null) return undefined;
    timer.current = setTimeout(() => setFailed("This page took too long to load."), LOAD_LIMIT_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [src, loaded, failed]);
  const name = site?.name ?? "Artifact";
  const line = site ? subline(infoOf(site, nameOf), rt.me.id, rt.clock().now, nameOf) : "";
  const browser = (): void => { void open(false).then((u) => rt.openUrl(u), (e: unknown) => setFailed(msg(e))); };
  const copy = (): void => { void (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard?.writeText?.(plainLink(rt.baseUrl, artifactId)); };
  const remove = (): void => { void Promise.resolve(rt.call("sites.delete", { siteId: artifactId })).then(gone, (e: unknown) => setFailed(msg(e))); };
  const [sure, setSure] = useState(false);
  const more = (): void => {
    const doc = (globalThis as { document?: { activeElement?: { getBoundingClientRect?: () => { right: number; bottom: number } } | null } }).document;
    const box = doc?.activeElement?.getBoundingClientRect?.();
    show([{ label: "Open in browser", onSelect: browser }, { label: "Copy link", onSelect: copy }, ...(site && site.owner === rt.me.id ? [{ separator: true as const }, { label: "Delete", danger: true, onSelect: () => setSure(true) }] : [])], box ? Math.max(8, box.right - 200) : 8, box ? box.bottom + 4 : 48, "other", { label: "Artifact" });
  };
  return (
    <View testID="artifact-view" style={s.root}>
      <View style={s.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Artifacts" testID="artifact-back" onPress={back} style={({ hovered }: { hovered?: boolean }) => [s.ib, hovered === true && s.hover]}><Text style={s.chev}>{"‹"}</Text></Pressable>
        <View style={s.titles}>
          <Text accessibilityRole="header" aria-level={1} numberOfLines={1} style={s.title}>{name}</Text>
          {line !== "" ? <Text testID="artifact-line" numberOfLines={1} style={s.line}>{line}</Text> : null}
        </View>
        <View style={s.grow} />
        {denied ? null : <Pressable accessibilityRole="button" accessibilityLabel="Share" testID="artifact-share" onPress={() => setSharing(true)} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.hover]}><Text style={s.btnText}>Share</Text></Pressable>}
        {denied ? null : <Pressable accessibilityRole="button" accessibilityLabel="More" testID="artifact-more" onPress={more} style={({ hovered }: { hovered?: boolean }) => [s.ib, hovered === true && s.hover]}><Text style={s.dots}>{"…"}</Text></Pressable>}
      </View>
      {sure ? (
        <View testID="artifact-sure" style={s.sure}>
          <Text style={s.sureText}>{`Delete “${name}”? The link stops working for everyone it was shared with.`}</Text>
          <Pressable accessibilityRole="button" testID="artifact-keep" onPress={() => setSure(false)} style={s.btn}><Text style={s.btnText}>Keep it</Text></Pressable>
          <Pressable accessibilityRole="button" testID="artifact-delete" onPress={remove} style={s.btn}><Text style={[s.btnText, s.danger]}>Delete</Text></Pressable>
        </View>
      ) : null}
      <View style={s.body}>
        {denied ? (
          <View testID="artifact-denied" accessibilityRole="alert" style={s.state}>
            <Text style={s.stateTitle}>You don{"\u2019"}t have access</Text>
            <Text style={s.stateLine}>Ask the person who made it to share it with you.</Text>
            <View style={s.row}>
              {asked ? <View style={s.btn}><Text style={s.btnText}>Requested</Text></View> : <Pressable accessibilityRole="button" testID="artifact-request" onPress={() => void Promise.resolve(rt.call("access.request", { resource: { type: "site", id: artifactId }, level: "view", idempotencyKey: `req-${artifactId}-${rt.clock().now}` })).then(() => setAsked(true), (e: unknown) => setFailed(msg(e)))} style={s.primary}><Text style={s.primaryText}>Ask for access</Text></Pressable>}
            </View>
          </View>
        ) : failed !== null ? (
          <View testID="artifact-error" accessibilityRole="alert" style={s.state}>
            <Text style={s.stateTitle}>This page couldn{"’"}t load here</Text>
            <Text style={s.stateLine}>Your browser can still open it.</Text>
            <View style={s.row}>
              <Pressable accessibilityRole="button" testID="artifact-error-browser" onPress={browser} style={s.primary}><Text style={s.primaryText}>Open in browser</Text></Pressable>
              <Pressable accessibilityRole="button" testID="artifact-error-retry" onPress={() => setAttempt((n) => n + 1)} style={s.btn}><Text style={s.btnText}>Try again</Text></Pressable>
            </View>
          </View>
        ) : (
          <>
            {frameFor(src, desktop) === "desktop" ? <DesktopArtifactFrame url={src as string} title={name} covered={coveredBy({ sharing, menu: element !== null, sure })} onError={(m) => setFailed(m)} /> : null}
            {frameFor(src, desktop) === "iframe" ? createElement("iframe", { src: src as string, title: name, sandbox: "allow-scripts allow-forms allow-popups allow-downloads", referrerPolicy: "no-referrer", onLoad: () => setLoaded(true), onError: () => setFailed("This page couldn\u2019t load here."), style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", border: 0, background: "#fff" }, "data-testid": "artifact-frame" }) : null}
            {!loaded && !denied ? <View testID="artifact-loading" accessibilityRole="progressbar" accessibilityLabel={`Loading ${name}`} style={s.loading}><Text style={s.stateLine}>{`Loading ${name}`}</Text></View> : null}
          </>
        )}
      </View>
      {sharing ? <FolderShareSheet rt={rt} folderId={artifactId} resource={{ type: "site", id: artifactId, name }} onClose={() => setSharing(false)} /> : null}
      {element}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, height: 56, paddingLeft: 10, paddingRight: 14 },
  titles: { minWidth: 0, flexShrink: 1, marginLeft: 2 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string },
  line: { fontSize: 12.5, lineHeight: 16, color: "var(--ink-3)" as string },
  grow: { flex: 1 },
  ib: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  hover: { backgroundColor: "var(--hover)" },
  chev: { fontSize: 24, lineHeight: 26, color: "var(--ink-3)" as string },
  dots: { fontSize: 18, lineHeight: 20, color: "var(--ink-3)" as string },
  btn: { height: 30, paddingHorizontal: 13, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  danger: { color: "var(--danger)" as string },
  primary: { height: 30, paddingHorizontal: 13, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  primaryText: { fontSize: 13, fontWeight: "500", color: "var(--accent-ink)" as string },
  sure: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  sureText: { flex: 1, fontSize: 13, color: "var(--ink-2)" as string },
  body: { flex: 1, minHeight: 0, position: "relative", borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  loading: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 24 },
  stateTitle: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  stateLine: { fontSize: 13.5, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", gap: 6, marginTop: 14 },
});
