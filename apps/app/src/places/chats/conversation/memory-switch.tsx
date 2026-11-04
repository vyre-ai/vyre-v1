// "Don't remember this chat" (owner decision D11, 3 Nov 2026): one switch in the composer, off by default. On, the chat's learning pass skips it and nothing is written to memory.
// The state lives in memory's own store (memory.chat_learning.get and .set, which lane l-memlearn's shouldLearn reads), so there is one place it is kept. While it is on, the composer
// shows one quiet line, "Not remembering this chat", which turns it back off.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "./parts.tsx";

export const SWITCH_LABEL = "Don't remember this chat";
/** The hover text of the lock: what it is and what pressing does. */
export const SWITCH_TIP = "Remembering this chat. Press to stop.";
/** The hover text for the switch in each state. */
export const tipOf = (remember: boolean): string => (remember ? SWITCH_TIP : `${QUIET_LINE}. Press to remember it again.`);
export const QUIET_LINE = "Not remembering this chat";

/** What memory.chat_learning.get answers, as far as the switch reads it. A chat memory cannot answer for is remembered. */
export function rememberOf(out: unknown): boolean {
  return (out as { remember?: unknown } | null)?.remember !== false;
}

export function MemorySwitch({ threadId, call, say }: { threadId: string; call(cap: string, input: unknown): Promise<unknown>; say(line: string): void }): ReactElement {
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const callRef = useRef(call);
  callRef.current = call;
  useEffect(() => {
    let live = true;
    setRemember(true);
    callRef.current("memory.chat_learning.get", { threadId }).then((out) => { if (live) setRemember(rememberOf(out)); }, () => undefined);
    return () => { live = false; };
  }, [threadId]);
  const flip = (): void => {
    if (busy) return;
    const next = !remember;
    setBusy(true);
    setRemember(next);
    call("memory.chat_learning.set", { threadId, remember: next }).then(
      (out) => { setRemember(rememberOf(out)); setBusy(false); say(next ? "This chat is remembered again" : "Nothing from this chat will be remembered"); },
      () => { setRemember(!next); setBusy(false); say("Could not change that. Try again."); },
    );
  };
  return (
    <Pressable
      accessibilityRole="switch" accessibilityLabel={SWITCH_LABEL} accessibilityState={{ checked: !remember, busy }} aria-checked={!remember} testID="memory-switch"
      {...{ title: tipOf(remember) }}
      onPress={flip} style={st.box}
    >
      <View style={st.row}>
        <Glyph name={remember ? "memory" : "memoryoff"} size={16} color={remember ? "var(--ink-3)" : "var(--ink-2)"} />
        {remember ? null : <Text testID="memory-off-line" style={st.line}>{QUIET_LINE}</Text>}
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  box: { height: 32, minWidth: 32, justifyContent: "center", alignItems: "center", paddingHorizontal: 8, borderRadius: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  line: { fontSize: 12.5, color: "var(--ink-2)" as string },
});
