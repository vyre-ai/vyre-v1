// Mount for TALKMIC_01 (lane l-calendar): the composer's mic in its states, with a fake microphone and a fake Deepgram socket, so nothing is real. ?state=idle | listening | unset-member | unset-admin.
// listening: the shot script presses the mic; interim words arrive in the field and the level bars move. unset-*: nothing covers the person in a team Space; a press shows the line (an admin also gets the link).
// The query is read after hydration. No key and no network is touched here.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Composer, TalkContext } from "../../../ui/src/Composer/index.tsx";
import type { TalkPort } from "../../../ui/src/Composer/index.tsx";
import type { TalkSocket } from "../../../ui/src/Composer/talk.ts";

export const title = "Composer mic states";

const SESSION = { provider: "deepgram", url: "wss://api.deepgram.com/v1/listen", protocols: ["bearer", "jwt"], source: "space" as const, expiresIn: 30 };
const result = (text: string, final: boolean): string => JSON.stringify({ type: "Results", is_final: final, channel: { alternatives: [{ transcript: text }] } });

function fakeSocket(): TalkSocket {
  const s: TalkSocket = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, send() {}, close() {} };
  setTimeout(() => { s.readyState = 1; s.onopen?.({}); }, 60);
  setTimeout(() => s.onmessage?.({ data: result("Can you send Elena the lease draft", true) }), 220);
  setTimeout(() => s.onmessage?.({ data: result("and ask her to confirm Thurs", false) }), 420);
  return s;
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const state = q?.get("state") ?? "idle";
  const port = useMemo<TalkPort>(() => {
    const unset = state === "unset-member" ? { admin: false, open: () => undefined } : state === "unset-admin" ? { admin: true, open: () => undefined } : undefined;
    return {
      on: true,
      session: async () => { if (unset) throw Object.assign(new Error("Talk needs a key."), { details: { reason: "no_key" } }); return SESSION; },
      setup: async () => false,
      noteOff: () => undefined,
      ...(unset ? { unset } : {}),
      deps: {
        openMic: async (on) => { const id = setInterval(() => on(new ArrayBuffer(0), 0.25 + Math.random() * 0.6), 110); return { stop: () => clearInterval(id) }; },
        openSocket: () => fakeSocket(),
        online: () => true, now: () => Date.now(), later: (fn, ms) => setTimeout(fn, ms), shell: "web",
      },
    };
  }, [state]);
  if (!q) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", padding: 24, maxWidth: 760, alignSelf: "center", width: "100%" }}>
      <TalkContext.Provider value={port}><Composer whoWillAnswer="" /></TalkContext.Provider>
    </View>
  );
}
