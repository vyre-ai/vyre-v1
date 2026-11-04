// Acts on a held /open link once a Space is open: reach decides, the shell opens the page, or a small card says what kind of thing it is and offers Ask for access. Never a dead end.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ShellHub } from "../spaces/hub.ts";
import { adminPages } from "../providers/settings-admin.ts";
import { decideOpen, onOpenHeld, peekOpen, takeOpen } from "./open-link.ts";
import type { OpenItem } from "./open-link.ts";
import { TELL_SENT } from "./reach.ts";

const leave = (): void => {
  const h = (globalThis as { history?: { state: unknown; replaceState(s: unknown, t: string, u: string): void } }).history;
  const at = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? "";
  if (at.startsWith("/open/")) h?.replaceState(h.state, "", "/chat");
};

export function OpenLink({ hub }: { hub: ShellHub }): ReactElement | null {
  const [held, setHeld] = useState<OpenItem | null>(() => peekOpen());
  const [shown, setShown] = useState<{ text: string; ask: { type: string; id: string } | null } | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => onOpenHeld(() => setHeld(peekOpen())), []);
  useEffect(() => {
    if (held === null) return undefined;
    let live = true;
    const item = takeOpen();
    if (item === null) return undefined;
    const s = hub.session();
    const rt = s.runtime;
    const nav = rt.call("console.nav", {}).then((o) => adminPages({ groups: [], ...(o as object) } as Parameters<typeof adminPages>[0]), () => new Set<string>());
    void decideOpen(item, { viewer: () => ({ id: s.me.id, spaceId: s.def.spaceId }), call: (c, i) => rt.call(c, i), consolePages: () => nav, memo: new Map() }).then((d) => {
      if (!live) return;
      setHeld(null);
      if (d.to === "open") { leave(); rt.open(d.target); return; }
      leave();
      hub.go("chats");
      setShown({ text: d.text, ask: d.ask });
    });
    return () => { live = false; };
  }, [held, hub]);
  if (shown === null) return null;
  const ask = async (): Promise<void> => {
    if (!shown.ask) return;
    try { await hub.session().runtime.call("access.request", { resource: shown.ask, level: "view", idempotencyKey: `open:${shown.ask.type}:${shown.ask.id}` }); } catch { /* an earlier ask stands */ }
    setAsked(true);
  };
  return (
    <View testID="open-link-peek" style={st.wrap} accessibilityRole="alert">
      <Text style={st.text}>{shown.text}</Text>
      {shown.ask ? asked ? <Text testID="open-link-asked" style={st.text}>{" · Asked for access"}</Text> : (
        <Pressable accessibilityRole="link" testID="open-link-ask" onPress={() => void ask()}><Text style={st.link}>{" · Ask for access"}</Text></Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="open-link-close" onPress={() => setShown(null)}><Text style={st.text}>{"  ×"}</Text></Pressable>
    </View>
  );
}

export const OPEN_SENT = TELL_SENT;

const st = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 24, alignSelf: "center", flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: "auto" as unknown as number, maxWidth: 520, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  text: { fontSize: 13, color: "var(--ink)" as string },
  link: { fontSize: 13, color: "var(--accent)" as string },
});
