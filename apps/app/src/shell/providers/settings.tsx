// The Settings place in the shell (spec 3.9): ten pages over the Space's data. The open Space is the one Space the runtime knows; leaving Settings (Vault, Console, Connections) goes
// out through the shell's door. Before the runtime exists the place draws its loading frame.
import { useEffect, useMemo, useState } from "react";
import { desktopSessionImporter } from "../../../../../client/src/session-import/desktop.ts";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { SettingsDataProvider } from "../../places/settings/data.tsx";
import type { DesktopUpdater, SettingsData } from "../../places/settings/data.tsx";
import { SecuritySheet } from "../../places/settings/SecuritySheet.tsx";
import type { SettingsNav } from "../../places/settings/data.tsx";
import { SettingsPlace } from "../../places/settings/SettingsPlace.tsx";
import { PAGES } from "../../places/settings/model.ts";
import type { PageKey } from "../../places/settings/model.ts";
import { usePlaceHash } from "../hash/context.tsx";
import { nameOf } from "./misc-common.ts";
import { chooseProfilePhoto } from "./settings-photo.ts";
import { loadSecurity } from "./settings-security.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import { addServerAsked, useAddServerNonce } from "../computers-available.ts";
import type { ShellRuntime } from "./runtime.tsx";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

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

export function settingsData(rt: ShellRuntime, manageSecurity?: SettingsNav["manageSecurity"], security?: SettingsData["security"]): SettingsData {
  return {
    ...(security ? { security } : {}),
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
      openConsole: () => rt.open({ screen: "console.overview" }),
      openSpace: (id) => rt.open({ screen: "spaces.switcher", args: { id } }),
      connect: (kind) => kind === "twilio" ? rt.open({ screen: "vault.layout", args: { add: "twilio" } }) : rt.open({ screen: "settings.page", args: { page: "connections" } }),
      choosePhoto: () => chooseProfilePhoto(rt),
      ...(manageSecurity ? { manageSecurity } : {}),
    },
    clock: () => rt.clock(),
  };
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
  const asked = target.screen === "mail.connections" ? "connections" : typeof target.args["page"] === "string" ? target.args["page"] : "";
  const page = PAGES.some((x) => x.key === asked) ? (asked as PageKey) : undefined;
  const data = useMemo(() => (rt ? settingsData(rt, (kind) => setSecurity(kind), signIn) : null), [rt, signIn]);
  if (!data) return <View style={s.page} testID="settings-loading" />;
  return <SettingsDataProvider value={data}><SettingsPlace key={`${nonce}:${page ?? ""}`} {...(addServerAsked() ? { initialPage: "computer" as const } : page ? { initialPage: page } : {})} />{security ? <SecuritySheet key={security} action={security} call={rt!.call} onClose={() => setSecurity(null)} /> : null}</SettingsDataProvider>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: "var(--win)" as string } });
