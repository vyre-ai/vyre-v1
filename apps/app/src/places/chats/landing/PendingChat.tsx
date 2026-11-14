// A chat the person has just started, drawn before the server has answered (budget: his own words on screen within 100 ms of the key press, on any network). Nothing about showing what he wrote needs the
// server: his message, the title the tab takes, the agent's working mark. If the start fails he sees it here, with Retry, and his words stay. The real conversation takes the place of this one when it has loaded.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WorkingMark } from "../../../../../../ui/src/WorkingMark/index.tsx";
import { StreamText } from "../../../../../../ui/src/stream/StreamText.tsx";
import { COLUMN } from "../../../../../../ui/src/tokens/calm.ts";
import type { TurnStreams } from "../../../shell/session/turn-streams.ts";
import { useOptionalShellRuntime } from "../../../shell/providers/runtime.tsx";
import { ActivityLine } from "../conversation/ActivityLine.tsx";
import { each } from "../../../shell/sidebar/model.ts";
import { READABLE_GRACE_MS, pendingFor, releasePending, touchPending } from "./pending.ts";
import { retryLoads } from "../../../../../../ui/src/States/retry.ts";

export interface PendingChatProps {
  title: string;
  text: string;
  /** Names of files that go with the message. */
  files: readonly string[];
  /** Who will answer. */
  lead: string;
  phase: "sending" | "failed";
  /** What went wrong, in plain words (failed only). */
  note?: string;
  onRetry?: () => void;
  onDiscard?: () => void;
  /** Once the chat has an id: its live turns are drawn here, the moment their words exist, until the conversation itself has loaded. */
  live?: { turns: TurnStreams; threadId: string } | { turns: TurnStreams; asker: string; since: number };
}

const NONE: readonly never[] = [];
const noSub = (): (() => void) => () => undefined;

/** The replies being written in this chat, from the same live frames the conversation reads: the steps it takes and its first words, with nothing waiting for the chat to load. */
function LiveReplies({ live, lead }: { live: NonNullable<PendingChatProps["live"]>; lead: string }): ReactElement {
  const { turns } = live;
  // before the chat has an id its reply is found by who asked and when: the first words can reach this window before the answer to chat.start does
  const list = useSyncExternalStore(
    turns.subscribe,
    () => ("threadId" in live ? turns.turnsOf(live.threadId) : turns.askedBy(live.asker, live.since)),
    () => NONE,
  );
  if (list.length === 0) return <Thinking lead={lead} />;
  return (
    <View testID="landing-live" style={st.replies}>
      {each(list, (t) => {
        const activity = turns.activityOf(`turn:${t.turnId}`);
        return (
          <View key={t.turnId} testID={`pending-turn-${t.turnId}`} style={st.reply}>
            {t.state === "writing" ? (
              activity ? (
                <ActivityLine store={activity} stream={t.store} />
              ) : (
                <Thinking lead={lead} />
              )
            ) : null}
            <StreamText store={t.store} />
          </View>
        );
      })}
    </View>
  );
}

function Thinking({ lead }: { lead: string }): ReactElement {
  return (
    <View testID="landing-working" style={st.working}>
      <WorkingMark state="thinking" size={20} testID="working-mark" />
      <Text style={st.workingText}>{lead === "" ? "Thinking" : `${lead} is thinking`}</Text>
    </View>
  );
}

export function PendingChat({
  title,
  text,
  files,
  lead,
  phase,
  note,
  onRetry,
  onDiscard,
  live,
}: PendingChatProps): ReactElement {
  return (
    <View testID="landing-pending" accessibilityLabel={`Starting ${title}`} style={st.root}>
      <View style={st.head}>
        <Text numberOfLines={1} testID="landing-pending-title" style={st.title}>
          {title}
        </Text>
      </View>
      <View style={st.feed}>
        <View style={st.me}>
          <View
            testID="msg-pending"
            accessibilityLabel="You"
            style={[st.bubble, phase === "failed" && st.bubbleFailed]}
          >
            {text.trim() !== "" ? <Text style={st.bubbleText}>{text}</Text> : null}
            {files.length > 0 ? <Text style={st.files}>{files.join(", ")}</Text> : null}
          </View>
        </View>
        {phase === "failed" ? (
          <View testID="landing-failed" accessibilityRole="alert" style={st.failed}>
            <Text style={st.failedText}>{note ?? "Could not start the chat."}</Text>
            <Pressable role="button" aria-label="Retry" testID="landing-retry" onPress={onRetry} style={st.link}>
              <Text style={st.linkText}>Retry</Text>
            </Pressable>
            <Pressable role="button" aria-label="Discard" testID="landing-discard" onPress={onDiscard} style={st.link}>
              <Text style={st.linkText}>Discard</Text>
            </Pressable>
          </View>
        ) : live ? (
          <LiveReplies live={live} lead={lead} />
        ) : (
          <Thinking lead={lead} />
        )}
      </View>
    </View>
  );
}

/** The chat that is opening, before its own messages have loaded: his first message, when this window sent it. Null for any chat this window did not just start. */
export function PendingOpening({ threadId, lead }: { threadId: string; lead?: string }): ReactElement | null {
  const p = pendingFor(threadId);
  const turns = useOptionalShellRuntime()?.turns;
  return p ? (
    <PendingChat
      title={p.title}
      text={p.text}
      files={p.files}
      lead={lead ?? p.lead}
      phase="sending"
      {...(turns ? { live: { turns, threadId } } : {})}
    />
  ) : null;
}

/**
 * A chat this window has just made, whose first read was refused or came back not found: the row is not readable on this device yet, which is not the same as "you cannot open this chat". The page keeps showing his
 * message and asks again every 1.5 s; only after the grace has passed does it say, in its own failed state with Retry and Discard, that it could not open the chat. Discard lets go of the held message and leaves the page's own failure.
 */
export function OpeningGuard({
  threadId,
  now = Date.now,
  grace = READABLE_GRACE_MS,
  children,
}: {
  threadId: string;
  now?: () => number;
  grace?: number;
  children: ReactElement;
}): ReactElement {
  const p = pendingFor(threadId);
  const [, tick] = useState(0);
  const waiting = p !== undefined && now() - (p.at ?? 0) < grace;
  useEffect(() => {
    if (p === undefined) return undefined;
    const again = setInterval(() => {
      if (now() - (p.at ?? 0) < grace) retryLoads();
      tick((n) => n + 1);
    }, 1500);
    return () => clearInterval(again);
  }, [p, now, grace]);
  if (p === undefined) return children;
  if (waiting) return <PendingOpening threadId={threadId} />;
  return (
    <PendingChat
      title={p.title}
      text={p.text}
      files={p.files}
      lead={p.lead}
      phase="failed"
      note="Could not open the chat."
      onRetry={() => {
        touchPending(threadId);
        retryLoads();
        tick((n) => n + 1);
      }}
      onDiscard={() => {
        releasePending(threadId);
        tick((n) => n + 1);
      }}
    />
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 10 },
  title: { flexShrink: 1, minWidth: 40, maxWidth: 320, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  feed: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: COLUMN,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 14,
  },
  me: { alignItems: "flex-end" },
  bubble: {
    maxWidth: "85%",
    backgroundColor: "var(--me)" as string,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  bubbleFailed: { opacity: 0.7 },
  bubbleText: { color: "var(--ink)" as string, fontSize: 15, lineHeight: 22 },
  files: { fontSize: 12.5, color: "var(--ink-3)" as string },
  replies: { gap: 14 },
  reply: { gap: 6 },
  working: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  workingText: { fontSize: 13, color: "var(--ink-2)" as string },
  failed: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 10, flexWrap: "wrap" },
  failedText: { fontSize: 12.5, color: "var(--danger)" as string },
  link: { paddingVertical: 2 },
  linkText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
