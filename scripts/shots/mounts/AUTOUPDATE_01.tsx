// Mount for AUTOUPDATE_01: Vyre updating itself. ?part=
//   updating (the Updating screen while it downloads), waiting (it waits for the reply in a named chat, with the time left and Stop and update now), waiting-two (two chats), stopped (the reply was ended cleanly, getting ready), failed (one line and Open Vyre anyway),
//   whats-new (the sheet over the shell on the first open after an update), dot (the shell with the quiet dot on Settings: the toggle is off and a newer version waits),
//   about (Settings, About Vyre: the version row, Update available with Update now, the toggle off, What's new)
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings, northwind } from "../../../apps/app/src/places/settings/sample.ts";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Message } from "../../../apps/app/src/places/chats/conversation/model.ts";
import { UpdatingScreen } from "../../../apps/app/src/startup/update/UpdatingScreen.tsx";
import { INSTALL_FAILED } from "../../../apps/app/src/startup/update/StartupUpdate.tsx";
import { WhatsNewSheet } from "../../../apps/app/src/startup/update/WhatsNewSheet.tsx";
import { AUTO_KEY } from "../../../apps/app/src/startup/update/model.ts";
import type { UpdateCheck } from "../../../apps/app/src/startup/update/model.ts";
import { setUpdateState } from "../../../apps/app/src/startup/update/store.ts";
import type { DesktopUpdates } from "../../../apps/app/src/startup/update/store.ts";

export const title = "Vyre updates itself";

const MB = 1024 * 1024;
const NOTES = {
  version: "1.0.0-rc.22",
  lines: [
    "Vyre now keeps itself up to date. When a new version is ready, it updates as it opens and you are back in a moment.",
    "A calm Updating screen shows how far along it is, and your chats and files stay just as they are.",
    "Settings has a new About Vyre page with your version, a Check now button and a switch for automatic updates.",
    "After each update you see a short note like this one about what got better.",
  ],
};
const WAITING: UpdateCheck = { phase: "available", current: "1.0.0-rc.21", channel: "beta", version: "1.0.0-rc.22", notes: NOTES.lines.slice(0, 2).join("\n"), checkedAt: Date.now() - 4 * 60_000 };
const fakeUpdates: DesktopUpdates = { startup: async () => WAITING, check: async () => WAITING, install: () => new Promise(() => undefined) };

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }

function ShellView({ skin, dot, children }: { skin: string; dot: boolean; children?: ReactNode }): ReactNode {
  const made = useMemo(() => {
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ theme });
    if (dot) hub.dot("settings", true);
    return { hub, theme };
  }, [skin, dot]);
  return <><Shell hub={made.hub} theme={made.theme} renderPlace={samplePlace} />{children}</>;
}

/** The chat after the update: the reply that was ended says so, once and quietly, and Continue runs it again. */
function StoppedChat({ skin }: { skin: string }): ReactNode {
  const data = useMemo(() => {
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const s = createSample("idle");
    const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
    const last = rows[rows.length - 1]!;
    s.replica.remove("messages", rows.map((m) => m.id));
    const mk = (n: number, author: Message["author"], body: string, blocks: unknown[] = []): Message => ({ messageId: `msg_upd_${n}`, threadId: s.data.threadId, threadSeq: last.threadSeq + n, author, kind: author.kind === "agent" ? "agent" : "person", body, depth: 0, attachments: [], reactions: [], pinned: false, createdAt: last.createdAt + n * 60_000, blocks } as unknown as Message);
    const stopped = { type: "turn_status", v: 1, id: "blk_stopped", state: "done", traceId: "tr", data: { state: "stopped_for_update", text: "Stopped for an update. Your message is kept.", turnId: "trn_stopped" } };
    const msgs = [mk(1, { kind: "person", id: s.data.me.id } as Message["author"], "Book Elena for Tuesday and send her the intake form."), mk(2, { kind: "agent", id: "agt_intake" } as Message["author"], "", [stopped])];
    s.replica.put("messages", msgs.map((m) => ({ id: m.messageId, ...m })));
    return s.data;
  }, [skin]);
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={data} /></View>;
}

function AboutView(): ReactNode {
  const sample = useMemo(() => {
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(AUTO_KEY, "0"); } catch { /* the toggle shows on */ }
    setUpdateState({ check: WAITING, installing: false });
    return createSampleSettings(northwind);
  }, []);
  return <SettingsDataProvider value={{ ...sample.data, desktopUpdater: fakeUpdates }}><SettingsPlace initialPage="about" /></SettingsDataProvider>;
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")), []);
  if (q === null) return <View style={{ flex: 1, backgroundColor: "var(--rail)" as string }} />;
  const part = q.get("part") ?? "updating";
  const skin = q.get("skin") ?? "paper";
  let body: ReactNode;
  if (part === "updating") body = <UpdatingScreen version="1.0.0-rc.22" progress={{ phase: "download", downloaded: 56.5 * MB, total: 134 * MB }} failure="" onOpenAnyway={() => undefined} />;
  else if (part === "waiting") body = <UpdatingScreen version="1.0.0-rc.22" progress={{ phase: "waiting", downloaded: 0, total: null, turns: 1, chats: ["Rivera intake"], left: 522, of: 600 }} failure="" onOpenAnyway={() => undefined} onStopNow={() => undefined} />;
  else if (part === "waiting-two") body = <UpdatingScreen version="1.0.0-rc.22" progress={{ phase: "waiting", downloaded: 0, total: null, turns: 2, chats: ["Rivera intake", "Weekly update"], left: 61, of: 600 }} failure="" onOpenAnyway={() => undefined} onStopNow={() => undefined} />;
  else if (part === "stopped") body = <UpdatingScreen version="1.0.0-rc.22" progress={{ phase: "stopping", downloaded: 0, total: null, turns: 2 }} failure="" onOpenAnyway={() => undefined} onStopNow={() => undefined} />;
  else if (part === "stopped-one") body = <UpdatingScreen version="1.0.0-rc.22" progress={{ phase: "stopping", downloaded: 0, total: null, turns: 1 }} failure="" onOpenAnyway={() => undefined} />;
  else if (part === "stopped-chat") body = <StoppedChat skin={skin} />;
  else if (part === "failed") body = <UpdatingScreen version="1.0.0-rc.22" progress={null} failure={INSTALL_FAILED} onOpenAnyway={() => undefined} />;
  else if (part === "whats-new") body = <ShellView skin={skin} dot={false}><WhatsNewSheet notes={NOTES} onClose={() => undefined} /></ShellView>;
  else if (part === "dot") body = <ShellView skin={skin} dot />;
  else body = <AboutView />;
  return <View style={StyleSheet.absoluteFill}>{body}</View>;
}
