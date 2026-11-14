// "Don't remember this chat" (owner decision D11, 3 Nov 2026): one switch in the composer, off by default. On, the chat's learning pass skips it and nothing is written to memory.
// The state lives in memory's own store (memory.chat_learning.get and .set, which lane l-memlearn's shouldLearn reads), so there is one place it is kept. While it is on, the composer
// shows one quiet line, "Not remembering this chat", which turns it back off.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "./parts.tsx";

export const SWITCH_LABEL = "Don't remember this chat";
/** The hover text of the lock: what it is and what pressing does. */
export const SWITCH_TIP = "Remembering this chat. Press to stop.";
/** The hover text for the switch in each state. */
export const tipOf = (remember: boolean): string =>
  remember ? SWITCH_TIP : `${QUIET_LINE}. Press to remember it again.`;
export const QUIET_LINE = "Not remembering this chat";

/** What memory.chat_learning.get answers, as far as the switch reads it. A chat memory cannot answer for is remembered. */
export function rememberOf(out: unknown): boolean {
  return (out as { remember?: unknown } | null)?.remember !== false;
}

/* The state of the switch is kept per chat in one small store, so the plus menu's row and the quiet chip in the composer say the same thing. */
interface Entry {
  remember: boolean;
  busy: boolean;
}
const entries = new Map<string, Entry>();
const subs = new Set<() => void>();
const FRESH: Entry = { remember: true, busy: false };
export const chatMemory = (threadId: string): Entry => entries.get(threadId) ?? FRESH;
const put = (threadId: string, e: Entry): void => {
  entries.set(threadId, e);
  for (const f of [...subs]) f();
};
const subscribe = (f: () => void): (() => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** Press: turn "Don't remember this chat" on or off. One write to memory's own store; a refused change puts the switch back. */
export function flipChatMemory(
  threadId: string,
  call: (cap: string, input: unknown) => Promise<unknown>,
  say: (line: string) => void,
): void {
  const was = chatMemory(threadId);
  if (was.busy) return;
  const next = !was.remember;
  put(threadId, { remember: next, busy: true });
  call("memory.chat_learning.set", { threadId, remember: next }).then(
    (out) => {
      put(threadId, { remember: rememberOf(out), busy: false });
      say(next ? "This chat is remembered again" : "Nothing from this chat will be remembered");
    },
    () => {
      put(threadId, { remember: !next, busy: false });
      say("Could not change that. Try again.");
    },
  );
}

/** Reads the chat's state once when the chat opens and follows the store after. */
function useChatMemory(threadId: string, call: (cap: string, input: unknown) => Promise<unknown>): Entry {
  const callRef = useRef(call);
  callRef.current = call;
  useEffect(() => {
    let live = true;
    callRef.current("memory.chat_learning.get", { threadId }).then(
      (out) => {
        if (live && !chatMemory(threadId).busy) put(threadId, { remember: rememberOf(out), busy: false });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [threadId]);
  return useSyncExternalStore(
    subscribe,
    () => chatMemory(threadId),
    () => FRESH,
  );
}

/**
 * The composer's one quiet line while "Don't remember this chat" is on, which turns it back off. While the chat is remembered (the default) nothing is drawn: the switch to turn it on is a row in
 * the plus menu (G47: no unlabelled icon beside the mic).
 */
export function MemorySwitch({
  threadId,
  call,
  say,
}: {
  threadId: string;
  call(cap: string, input: unknown): Promise<unknown>;
  say(line: string): void;
}): ReactElement | null {
  const { remember, busy } = useChatMemory(threadId, call);
  if (remember) return null;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={SWITCH_LABEL}
      accessibilityState={{ checked: true, busy }}
      aria-checked={true}
      testID="memory-switch"
      {...{ title: tipOf(false) }}
      onPress={() => flipChatMemory(threadId, call, say)}
      style={st.box}
    >
      <View style={st.row}>
        <Glyph name="memoryoff" size={16} color="var(--ink-2)" />
        <Text testID="memory-off-line" style={st.line}>
          {QUIET_LINE}
        </Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  box: {
    height: 32,
    minWidth: 32,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
    borderRadius: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  line: { fontSize: 12.5, color: "var(--ink-2)" as string },
});
