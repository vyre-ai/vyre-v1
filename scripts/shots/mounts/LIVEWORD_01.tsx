// Mount for chat-reply G21: the live word under a reply that is being written, as a person sees it. One real ActivityLine on a store that starts a turn now, starts a long tool call after 2 s and never ends it,
// so a picture at the start, in the call and a minute into it shows the word never leaves.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ActivityLine } from "../../../apps/app/src/places/chats/conversation/ActivityLine.tsx";
import type { ActivitySnapshot, ActivityStore } from "../../../apps/app/src/shell/session/turn-streams.ts";
import { Face } from "../../../apps/app/src/places/chats/needsyou/parts.tsx";

export const title = "Live word";

export default function Mount(): ReactNode {
  const store = useMemo(() => {
    let snap: ActivitySnapshot = { startedAt: Date.now(), thinking: "", steps: [], version: 0 };
    const ls = new Set<() => void>();
    const s: ActivityStore & { set(n: ActivitySnapshot): void } = {
      get: () => snap,
      subscribe: (l) => {
        ls.add(l);
        return () => ls.delete(l);
      },
      set: (n) => {
        snap = n;
        for (const l of [...ls]) l();
      },
    };
    return s;
  }, []);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const a = setTimeout(
      () =>
        store.set({
          ...store.get(),
          version: 1,
          steps: [{ id: "s1", name: "Bash", state: "live", detail: "npm test" }],
        }),
      2000,
    );
    const h = setInterval(() => setClock(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => {
      clearTimeout(a);
      clearInterval(h);
    };
  }, [store]);
  return (
    <View style={{ padding: 24, gap: 6, maxWidth: 560 }} testID="liveword">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Face name="Mira" seedId="mira" kind="agent" size={24} />
        <Text style={{ fontWeight: "600", color: "var(--ink)" as string }}>Mira</Text>
      </View>
      <ActivityLine store={store} />
      <Text
        testID="liveword-clock"
        style={{ color: "var(--ink-4)" as string, fontSize: 11 }}
      >{`${clock}s since the turn began`}</Text>
    </View>
  );
}
