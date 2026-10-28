// The Settings place in the shell (spec 3.9): ten pages over the Space's data. The open Space is the one Space the runtime knows; leaving Settings (Vault, Console, Connections) goes
// out through the shell's door. Before the runtime exists the place draws its loading frame.
import { useMemo, useState } from "react";
import { desktopSessionImporter } from "../../../../../client/src/session-import/desktop.ts";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { SettingsDataProvider } from "../../places/settings/data.tsx";
import type { SettingsData } from "../../places/settings/data.tsx";
import { SecuritySheet } from "../../places/settings/SecuritySheet.tsx";
import type { SettingsNav } from "../../places/settings/data.tsx";
import { SettingsPlace } from "../../places/settings/SettingsPlace.tsx";
import { nameOf } from "./misc-common.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function settingsData(rt: ShellRuntime, manageSecurity?: SettingsNav["manageSecurity"]): SettingsData {
  return {
    screens: rt.screens, call: rt.call, me: { id: rt.me.id, name: rt.me.name }, space: { id: rt.space.id, name: rt.space.name },
    spaces: [{ id: rt.space.id, name: rt.space.name, addr: "", kind: rt.space.kind, role: "", needsYou: 0, current: true }],
    name: nameOf(rt),
    sessionImporter: rt.space.kind === "personal" ? desktopSessionImporter() : undefined,
    async continueSession(conversationId) {
      if (rt.space.kind !== "personal") throw new Error("Open your Personal Space to continue this session.");
      const out = await rt.call("sessions.continue", { conversationId, destinationSpaceId: rt.space.id, destinationScope: "personal", agentId: rt.assistant.id }) as { threadId: string };
      rt.open({ screen: "chats.conversation", args: { threadId: out.threadId } });
    },
    nav: {
      openVault: () => rt.open({ screen: "vault.layout" }),
      openConsole: () => rt.open({ screen: "console.overview" }),
      openSpace: (id) => rt.open({ screen: "spaces.switcher", args: { id } }),
      connect: (kind) => rt.open({ screen: "mail.connections", args: { kind } }),
      choosePhoto: () => Promise.resolve(null),
      ...(manageSecurity ? { manageSecurity } : {}),
    },
    clock: () => rt.clock(),
  };
}

export default function SettingsShellPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const [security, setSecurity] = useState<Parameters<NonNullable<SettingsNav["manageSecurity"]>>[0] | null>(null);
  const data = useMemo(() => (rt ? settingsData(rt, (kind) => setSecurity(kind)) : null), [rt]);
  if (!data) return <View style={s.page} testID="settings-loading" />;
  return <SettingsDataProvider value={data}><SettingsPlace />{security ? <SecuritySheet key={security} action={security} call={rt!.call} onClose={() => setSecurity(null)} /> : null}</SettingsDataProvider>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: "var(--win)" as string } });
