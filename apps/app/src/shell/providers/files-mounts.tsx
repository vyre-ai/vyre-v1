// Files > Mounts in the shell (spec 2.16 Mounts, 3.5): Connect a folder opens the mount sheet over the Space's data; a mounted folder shows where it comes from, how it is doing, when it last
// synced and what waits, with Sync now, Pause or Resume, Review changes and Unmount. The sheet and the status line are the places' own; this gives them the Space (connections, devices, folders,
// people) and carries what they ask for to the capabilities. A source with no connection sends the person to connect it first.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MountSheet, MountsDataProvider, UnmountSheet } from "../../places/files/mounts/index.ts";
import { Mark } from "../../places/files/mounts/icons.tsx";
import { accountKey } from "../../places/files/mounts/model.ts";
import type { Accounts, MountRow, MountsData, SourceId } from "../../places/files/mounts/index.ts";
import { connectGithub, loadAccounts, mountLine, peopleOf, thisDevice, writableFolders } from "./files-mounts-data.ts";
import { useOpenConnect } from "../connect/index.ts";
import type { ShellRuntime } from "./runtime.tsx";

export type MountRequest = { kind: "mount"; into: string | null; source?: SourceId } | { kind: "unmount"; mount: MountRow };

/** What the sheet needs, read from the Space when it opens: who is connected, the folders a mount can go into, the people it can be shared with. */
export function useMountsData(rt: ShellRuntime): MountsData | null {
  const openConnect = useOpenConnect();
  const [loaded, setLoaded] = useState<{ accounts: Accounts; folders: Array<{ id: string; name: string }> } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [accounts, folders] = await Promise.all([thisDevice(rt.call).then((d) => loadAccounts(rt.call, d)), writableFolders(rt.call).catch(() => [])]);
      if (live) setLoaded({ accounts, folders });
    })();
    return () => { live = false; };
  }, [rt]);
  const people = useMemo(() => {
    const s = rt.principals.getSnapshot();
    return s.status === "ready" ? peopleOf(s.data, rt.me.id) : [];
  }, [rt]);
  const everyone = useMemo(() => {
    const s = rt.principals.getSnapshot();
    return s.status === "ready" ? s.data.find((p) => p.kind === "group" && /everyone|members|all/i.test(p.name))?.id : undefined;
  }, [rt]);
  return useMemo(() => loaded && ({
    call: rt.call, space: { name: rt.space.name, ...(everyone ? { everyoneGroupId: everyone } : {}) }, accounts: loaded.accounts, folders: loaded.folders, people,
    // A source with no connection: Google and Microsoft sign in right here (connect in place) and the new account is read back; the GitHub App is installed from Connections in Settings.
    connect: async (source) => {
      if (source === "github") {
        const got = await connectGithub(rt.call, (url) => rt.openUrl(url));
        if (got === "not_set_up") { rt.open({ screen: "mail.connections", args: { kind: "github" } }); return null; }
        return got;
      }
      if (!openConnect) { rt.open({ screen: "mail.connections", args: { kind: source === "google_drive" ? "gmail" : "outlook" } }); return null; }
      const got = await openConnect({ kind: "connector", service: source === "google_drive" ? "google" : "microsoft" });
      if (!got) return null;
      const fresh = await loadAccounts(rt.call, null);
      const acc = fresh[source === "google_drive" ? "google_drive" : "microsoft"];
      return acc.connected ? acc : { label: got.title, connected: true, connectionId: got.id };
    },
  }), [rt, loaded, people, everyone, openConnect]);
}

/** The sheets over the Files place: the mount sheet, or the Unmount sheet for a mounted folder. */
export function MountSheets({ rt, request, onClose, onChanged, onMounted }: { rt: ShellRuntime; request: MountRequest | null; onClose(): void; onChanged(): void; onMounted?(info: { folderId: string; name: string }): void }): ReactElement | null {
  const data = useMountsData(rt);
  if (!request || !data) return null;
  return (
    <MountsDataProvider value={data}>
      {request.kind === "mount"
        ? <MountSheet into={request.into ?? undefined} onClose={onClose} {...(request.source && data.accounts[accountKey(request.source)].connected ? { initial: { step: 2 as const, source: request.source } } : {})}
            onMounted={(info) => { onChanged(); onClose(); if (onMounted) onMounted({ folderId: info.folderId, name: info.name }); else rt.open({ subject: { type: "folder", id: info.folderId } }); }} />
        : <UnmountSheet mount={request.mount} onClose={onClose} onRemoved={() => { onChanged(); onClose(); }} />}
    </MountsDataProvider>
  );
}

/** One mount's row, when the open folder is the root of a mount. Re-read when something changed and every half minute, so a sync that finishes shows. */
export function useMountOf(rt: ShellRuntime, folderId: string | null, version: number): [MountRow | null, () => void] {
  const [row, setRow] = useState<MountRow | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (folderId === null) { setRow(null); return undefined; }
    let live = true;
    const read = (): void => { void (rt.call("mounts.list", {}) as Promise<{ mounts: MountRow[] }>).then((o) => { if (live) setRow(o.mounts.find((m) => m.folderId === folderId) ?? null); }, () => undefined); };
    read();
    const t = setInterval(read, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [rt, folderId, version, tick]);
  return [row, useCallback(() => setTick((n) => n + 1), [])];
}

/** The status line of a mounted folder: source, state, last sync, and its actions. Review changes opens the change set an agent or a sync staged, in the Files review screen. */
export function MountStrip({ rt, mount, onUnmount, onChanged }: { rt: ShellRuntime; mount: MountRow; onUnmount(): void; onChanged(): void }): ReactElement {
  const line = mountLine(mount, rt.clock().now);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!mount.reviewChanges) { setReview(null); return undefined; }
    void (rt.call("changesets.list", { folderId: mount.folderId, state: "open" }) as Promise<{ changesets: Array<{ changesetId: string }> }>).then((o) => { if (live) setReview(o.changesets[0]?.changesetId ?? null); }, () => undefined);
    return () => { live = false; };
  }, [rt, mount.folderId, mount.reviewChanges, mount.pendingChanges, mount.lastSyncAt]);
  const run = (cap: string, words: string): void => {
    setBusy(true); setSaid(null);
    void rt.call(cap, { mountId: mount.mountId }).then(
      () => { setSaid(words); onChanged(); },
      (e: unknown) => setSaid(e instanceof Error ? e.message : "That did not work. Try again."),
    ).finally(() => setBusy(false));
  };
  const act = (label: string, onPress: () => void, testID: string, danger = false): ReactElement => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} disabled={busy} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [st.btn, hovered === true && st.btnOver, busy && { opacity: 0.5 }]}>
      <Text style={[st.btnText, danger && st.danger]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={st.strip} testID="mount-strip" accessibilityRole="summary" accessibilityLabel={`${line.source}. ${line.state}. ${line.detail}`}>
      <Mark kind={mount.kind === "google_drive" ? "google_drive" : mount.kind} size={22} />
      <View style={st.text}>
        <Text numberOfLines={1} style={st.title}>{line.source}</Text>
        <Text numberOfLines={2} style={st.note}><Text style={line.tone === "bad" ? st.bad : line.tone === "warn" ? st.warn : st.ok}>{line.state}</Text>{`  ${said ?? line.detail}`}</Text>
      </View>
      <View style={st.acts}>
        {review ? act("Review changes", () => rt.open({ screen: "files.diff", args: { changesetId: review } }), "mount-review") : null}
        {line.canSync ? act("Sync now", () => run("mounts.sync_now", "Sync started"), "mount-sync") : null}
        {line.paused ? act("Resume", () => run("mounts.resume", "Resumed"), "mount-resume") : act("Pause", () => run("mounts.pause", "Paused"), "mount-pause")}
        {act("Unmount…", onUnmount, "mount-unmount", true)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--side)" as string, flexWrap: "wrap" },
  text: { flex: 1, minWidth: 200 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string },
  ok: { color: "var(--ok)" as string }, warn: { color: "var(--warn, var(--ink-2))" as string }, bad: { color: "var(--danger)" as string },
  acts: { flexDirection: "row", gap: 2, alignItems: "center" },
  btn: { height: 28, paddingHorizontal: 10, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, color: "var(--accent)" as string },
  danger: { color: "var(--danger)" as string },
});

