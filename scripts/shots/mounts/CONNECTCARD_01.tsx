// Mount for the b-connect lane: the connect card of a chat (finding F38) in every state, over a scripted server that answers vault.connect_card.* the way the real one does. ?part=
//   ask | menu | working | done | doneopen | wrong | have | admin | asked | later | offline
// The part sets the first answer; the shoot script (connect-shoot.mjs) then types and presses the way a person does, so every picture is the real component after real presses.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { ConnectCardLive } from "../../../apps/app/src/places/chats/conversation/connectcard.tsx";

export const title = "Connect card";

const FIELDS = [
  { name: "api_key", label: "API key", optional: false },
  { name: "webhook_secret", label: "Webhook secret", optional: true },
];
const base = (state: string, over: Record<string, unknown> = {}) => ({
  requestId: "vrq_1",
  state,
  service: { key: "fathom", title: "Fathom", site: "https://fathom.video" },
  fields: FIELDS,
  agentId: "agt_dex",
  mayFill: true,
  keptIn: "Mine",
  usedBy: [{ kind: "agent", id: "agt_dex" }],
  ...over,
});
const FOLDERS = [
  { id: "vfd_mine", name: "Mine", scope: "mine", usable: true },
  { id: "vfd_mkt", name: "Marketing", scope: "shared", usable: true },
  { id: "vfd_ops", name: "Operations", scope: "shared", usable: true },
  { id: "vfd_fin", name: "Finance", scope: "shared", usable: false },
];

function Scene({ part }: { part: string }): ReactNode {
  const first: Record<string, ReturnType<typeof base>> = {
    ask: base("ask"),
    menu: base("ask"),
    working: base("ask"),
    done: base("ask"),
    doneopen: base("ask"),
    wrong: base("ask"),
    offline: base("ask"),
    have: base("have", { have: { itemId: "vit_old", name: "Fathom", keptIn: "Mine" } }),
    admin: base("admin", { mayFill: false, admin: { id: "usr_maya" } }),
    asked: base("asked", { mayFill: false, admin: { id: "usr_maya", askedAt: Date.now() - 60_000 } }),
    later: base("later"),
  };
  const data = useMemo(() => {
    let cur = first[part] ?? first["ask"]!;
    const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
      if (cap === "vault.connect_card.get") return { card: cur };
      if (cap === "vault.connect_card.options") return { folders: FOLDERS, default: "vfd_mine" };
      if (cap === "vault.connect_card.submit") {
        if (part === "working") return new Promise(() => undefined);
        const typed = JSON.stringify(input["fields"] ?? "");
        if (part === "wrong" || typed.includes("bad-")) cur = base("wrong");
        else if (part === "offline" && !String(input["retry"] ?? "")) cur = base("offline");
        else cur = base("connected", { tested: "Reached Fathom", keptIn: "Mine" });
        return { result: cur.state === "connected" ? "connected" : cur.state, card: cur };
      }
      if (cap === "vault.connect_card.ask_admin")
        return { card: (cur = base("asked", { mayFill: false, admin: { id: "usr_maya", askedAt: Date.now() } })) };
      if (cap === "vault.requests.decline") {
        cur = base("later");
        return { ok: true };
      }
      if (cap === "vault.connect_card.reopen") return { card: (cur = base("ask")) };
      if (cap === "vault.connect_card.disconnect") return { card: (cur = base("later")) };
      return {};
    };
    return { call, nameOf: (id: string) => (id === "usr_maya" ? "Maya" : id) } as never;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part]);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "var(--ink)" as string }}>Dex</Text>
        <Text style={{ fontSize: 14, color: "var(--ink)" as string }}>
          {part === "admin" || part === "asked"
            ? "Not yet. Maya can connect it."
            : part === "have"
              ? "Not here yet. You have a saved key I can use."
              : "Not yet. Add its key and I'll connect it."}
        </Text>
      </View>
      <ConnectCardLive requestId="vrq_1" agent="Dex" data={data} />
    </View>
  );
}

export default function Mount_(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(
    () =>
      setPart(
        new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ??
          "ask",
      ),
    [],
  );
  const { width, height } = useWindowDimensions();
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string }}>
      <ScrollView contentContainerStyle={{ alignItems: "center", paddingTop: 24, paddingBottom: 40 }}>
        <View style={{ width: Math.min(640, width - 32) }}>
          <Scene part={part} />
        </View>
      </ScrollView>
    </View>
  );
}
