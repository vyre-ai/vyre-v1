// The Settings place in the shell: You, and for someone who can change it, the Space with the Console's pages. The open Space is the one Space the runtime knows; leaving Settings goes out
// through the shell's door. Before the runtime exists the place draws its loading frame.
import { useEffect, useMemo, useState } from "react";
import { desktopSessionImporter } from "../../../../../client/src/session-import/desktop.ts";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { SettingsDataProvider } from "../../places/settings/data.tsx";
import type { DesktopUpdater, SettingsData } from "../../places/settings/data.tsx";
import { SecuritySheet } from "../../places/settings/SecuritySheet.tsx";
import { LinkSheet } from "../../places/settings/LinkSheet.tsx";
import { readStoredSpace, writeStored } from "../session/stored.ts";
import { deviceFor } from "../../join/logic.ts";
import type { SettingsNav } from "../../places/settings/data.tsx";
import { SettingsPlace } from "../../places/settings/SettingsPlace.tsx";
import { OLD_PAGES, PAGES } from "../../places/settings/model.ts";
import type { PageKey } from "../../places/settings/model.ts";
import { usePlaceHash } from "../hash/context.tsx";
import { applySkinToWindow } from "./settings-skin.ts";
import { nameOf } from "./misc-common.ts";
import { openAskPane } from "../ask/pane.ts";
import { chooseProfilePhoto } from "./settings-photo.ts";
import { loadSecurity } from "./settings-security.ts";
import { adminPages, adminTarget } from "./settings-admin.ts";
import { PAGES as CONSOLE_PAGES } from "../../console/shell/nav.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import { addServerAsked, useAddServerNonce } from "../computers-available.ts";
import type { ShellRuntime } from "./runtime.tsx";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

// the Console's pages load the first time one opens, so Settings itself stays light

/** The desktop shell's two fixed update commands (src-tauri/src/updater.rs); undefined in a browser. */
export function desktopUpdater(invoke: Invoke | undefined = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke): DesktopUpdater | undefined {
  if (!invoke) return undefined;
  return {
    async check() {
      const r = (await invoke("check_desktop_update")) as Record<string, unknown> | null;
      if (!r || typeof r["current"] !== "string" || typeof r["channel"] !== "string") throw new Error("The update server gave an answer Vyre could not read.");
      return { current: r["current"], channel: r["channel"], version: typeof r["version"] === "string" ? r["version"] : null, notes: typeof r["notes"] === "string" ? r["notes"] : null };
    },
    async install() { await invoke("install_desktop_update"); },
  };
}

export function settingsData(rt: ShellRuntime, manageSecurity?: SettingsNav["manageSecurity"], security?: SettingsData["security"], consoleAllowed = false): SettingsData {
  return {
    ...(security ? { security } : {}),
    // Ask about a Settings page opens the pane beside it, about that page; the person's own settings are theirs to change, so the assistant may propose changes they then approve
    ask: (page) => { openAskPane({ thing: { kind: "settings_page", id: page.key, title: page.title }, context: { actions: ["explain a setting", "find a setting", "change a setting after the person says yes"] } }, "settings"); },
    ...(consoleAllowed ? { openConsole: () => rt.open({ screen: "console.overview" }), openCompany: () => rt.open({ screen: "company.setup" }) } : {}),
    screens: rt.screens, call: rt.call, me: { id: rt.me.id, name: rt.me.name, ...(rt.me.username ? { username: rt.me.username } : {}) }, space: { id: rt.space.id, name: rt.space.name },
    spaces: rt.knownSpaces?.map(space=>({id:space.spaceId,name:space.name,addr:space.address,kind:space.kind,role:space.role,needsYou:space.needsYou?1:0,current:space.spaceId===rt.space.id}))??[{ id: rt.space.id, name: rt.space.name, addr: "", kind: rt.space.kind, role: "", needsYou: 0, current: true }],
    name: nameOf(rt),
    sessionImporter: rt.space.kind === "personal" ? desktopSessionImporter() : undefined,
    desktopUpdater: desktopUpdater(),
    async continueSession(conversationId) {
      if (rt.space.kind !== "personal") throw new Error("Open your Personal Space to continue this session.");
      const out = await rt.call("sessions.continue", { conversationId, destinationSpaceId: rt.space.id, destinationScope: "personal", agentId: rt.assistant.id }) as { threadId: string };
      rt.open({ screen: "chats.conversation", args: { threadId: out.threadId } });
    },
    nav: {
      openVault: () => rt.open({ screen: "vault.layout" }),
      openSpace: (id) => rt.open({ screen: "spaces.switcher", args: { id } }),
      connect: (kind) => kind === "twilio" ? rt.open({ screen: "vault.layout", args: { add: "twilio" } }) : rt.open({ screen: "settings.page", args: { page: "mail" } }),
      openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
      openLink: (link) => rt.openUrl(link),
      choosePhoto: () => chooseProfilePhoto(rt),
      applySkin: (skinId) => void applySkinToWindow(rt, skinId),
      ...(manageSecurity ? { manageSecurity } : {}),
    },
    clock: () => rt.clock(),
  };
}

const isDesktopWindow = (): boolean => !!(globalThis as { __TAURI__?: unknown }).__TAURI__;

/** Every Space this device is in, this one first, for "Use one account everywhere" (rc.17). */
export function linkSpaces(rt: ShellRuntime): { name: string; spaceId: string; call: (cap: string, input: unknown) => Promise<unknown> }[] {
  const callIn = rt.callIn;
  const here = { name: rt.space.name, spaceId: rt.space.id, call: rt.call };
  if (!callIn || !rt.knownSpaces) return [here];
  return [here, ...rt.knownSpaces.filter((x) => x.spaceId !== rt.space.id).map((x) => ({ name: x.name, spaceId: x.spaceId, call: (cap: string, input: unknown) => callIn(x.spaceId, cap, input) }))];
}

/** A Space that took the kept account answered with a new session for this device (its old ones ended): store it; the open Space reloads on it. */
export function storeLinkedSession(spaceId: string, token: string, username: string, openSpace: string): void {
  const stored = readStoredSpace(spaceId);
  if (stored) writeStored({ ...stored, token, username });
  if (spaceId === openSpace) (globalThis as { location?: { reload(): void } }).location?.reload();
}

/** The other Spaces this device is in, reached as the same person: a new recovery code replaces the old one there too. */
export function otherSpaces(rt: ShellRuntime): { name: string; call: (cap: string, input: unknown) => Promise<unknown> }[] {
  const callIn = rt.callIn;
  if (!callIn || !rt.knownSpaces) return [];
  return rt.knownSpaces.filter((x) => x.spaceId !== rt.space.id).map((x) => ({ name: x.name, call: (cap: string, input: unknown) => callIn(x.spaceId, cap, input) }));
}

export default function SettingsShellPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const [security, setSecurity] = useState<Parameters<NonNullable<SettingsNav["manageSecurity"]>>[0] | null>(null);
  // the sign-in this person has in the open Space: password, GitHub, authenticator app, passkeys, the second-factor floor, single sign-on and devices
  const [signIn, setSignIn] = useState<SettingsData["security"] | undefined>(undefined);
  useEffect(() => {
    if (!rt) return undefined;
    let live = true;
    void loadSecurity(rt.call, rt.space, rt.clock().now).then((x) => { if (live) setSignIn(x); }, () => undefined);
    return () => { live = false; };
  }, [rt, security]);
  const nonce = useAddServerNonce();
  // a link into Settings names its page ({ page } or the mail connections screen); without this it always opened Profile
  const { target } = usePlaceHash();
  const raw = target.screen === "mail.connections" ? "mail" : typeof target.args["page"] === "string" ? target.args["page"] : "";
  const asked = OLD_PAGES[raw] ?? raw;
  const page = PAGES.some((x) => x.key === asked) ? (asked as PageKey) : undefined;
  const { page: _page, admin: askedAdmin, ...adminArgs } = target.args as Record<string, string>;
  // may this person open the Console? The same read the Console itself makes
  const [pages, setPages] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!rt || rt.space.kind === "personal" || rt.plainRole === true) return undefined;   // a Member or Guest has no Console to open
    let live = true;
    void rt.call("console.nav", {}).then((out) => { if (live) setPages(adminPages(out as Parameters<typeof adminPages>[0])); }, () => undefined);
    return () => { live = false; };
  }, [rt]);
  const consoleAllowed = pages !== null && pages.size > 0;
  // an old address for a Console page inside Settings now opens that page in the Console
  useEffect(() => {
    const screen = CONSOLE_PAGES.find((p) => p.id === askedAdmin)?.screen;
    if (rt && screen) rt.open(adminTarget(screen, adminArgs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, askedAdmin]);
  const data = useMemo(() => (rt ? settingsData(rt, (kind) => setSecurity(kind), signIn, consoleAllowed) : null), [rt, signIn, consoleAllowed]);
  if (!data) return <View style={s.page} testID="settings-loading" />;
  return <SettingsDataProvider value={data}><SettingsPlace key={`${nonce}:${page ?? ""}:${askedAdmin ?? ""}`} {...(addServerAsked() ? { initialPage: "computer" as const } : page ? { initialPage: page } : {})} />{security === "link" ? <LinkSheet spaces={linkSpaces(rt!)} device={deviceFor(isDesktopWindow() ? "desktop" : "web")} onSession={(id, token, username) => storeLinkedSession(id, token, username, rt!.space.id)} onClose={() => setSecurity(null)} /> : security ? <SecuritySheet key={security} action={security} call={rt!.call} onClose={() => setSecurity(null)} spaceName={rt!.space.name} others={otherSpaces(rt!)} /> : null}</SettingsDataProvider>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: "var(--win)" as string } });
