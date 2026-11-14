// Nothing sits on a loading mark for ever. Every place that loads draws one of two things: the quiet mark while it waits, or, the moment a read fails, a plain error with Retry.
// A read that fails keeps the query in `loading` with the reason in `error` (client QueryState), so "still loading" and "failed" are told apart here, in one place, not by each screen.
// Retry asks the Space's session to read again what is on screen: it sends RETRY_LOADS_EVENT, which the session answers by re-reading every watched query.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { States } from "./index.tsx";

export {
  BACK_LABEL,
  CANNOT_READ,
  BACK_TO_START_EVENT,
  REFUSED_CAUSE,
  RETRY_LOADS_EVENT,
  backToStart,
  failureOf,
  isRefused,
  onBackToStart,
  onRetryLoads,
  refusalFinal,
  retryLoads,
} from "./retry.ts";
export type { LoadFailure } from "./retry.ts";
import { BACK_LABEL, CANNOT_READ, REFUSED_CAUSE, backToStart, isRefused, retryLoads } from "./retry.ts";
import type { LoadFailure } from "./retry.ts";

/** The way out Chats gives a refusal: its start. Only Chats listens for it, so only Chats passes it. */
export const BACK_TO_CHATS = { label: BACK_LABEL, onPress: backToStart } as const;

/** The error a place draws where its content would be: "Couldn't load <what>", the reason, Retry, and the trace id behind Details. */
export function LoadFailed({
  what,
  failure,
  onRetry = retryLoads,
  testID = "load-failed",
  refusable = true,
  compact = false,
  back,
}: {
  what: string;
  failure: LoadFailure;
  onRetry?: () => void;
  testID?: string;
  /** False where a person cannot be refused (the list of what needs them): the read failed, so Retry stays. */
  refusable?: boolean;
  /** One quiet row-height line (a section of a list that failed): the words and Retry; a refusal says so plainly with no Retry. Same rules as the block; the reason and trace id stay for the block. */
  compact?: boolean;
  /** The way out of a refusal, from the place that can take a person somewhere (Chats: BACK_TO_CHATS). Without one a refusal draws no button: a button nothing hears is a dead end. */
  back?: { label: string; onPress: () => void };
}): ReactElement {
  const refused = refusable && isRefused(failure);
  const cannot = failure.code === CANNOT_READ;
  if (compact)
    return (
      <View testID={testID} style={st.line}>
        <Text numberOfLines={1} style={st.lineText}>
          {refused ? `You can't open ${what}` : `Couldn't load ${what}`}
        </Text>
        {refused || cannot ? null : (
          <Pressable accessibilityRole="button" testID={`${testID}-retry`} onPress={onRetry} style={st.lineRetry}>
            <Text style={st.lineRetryText}>Retry</Text>
          </Pressable>
        )}
      </View>
    );
  // a refusal is not a failure to wait out: say so plainly and offer no Retry, which could never work
  if (refused)
    return (
      <View testID={testID} style={st.fill}>
        <States
          kind="error"
          message={`You can't open ${what}`}
          cause={REFUSED_CAUSE}
          {...(back ? { action: back } : {})}
          {...(failure.traceId ? { traceId: failure.traceId } : {})}
        />
      </View>
    );
  return (
    <View testID={testID} style={st.fill}>
      <States
        kind="error"
        message={`Couldn't load ${what}`}
        cause={failure.message}
        {...(failure.code ? { code: failure.code } : {})}
        {...(failure.traceId ? { traceId: failure.traceId } : {})}
        {...(cannot ? {} : { retryable: true, onRetry })}
      />
    </View>
  );
}

const st = StyleSheet.create({
  line: { height: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  lineText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-3)" as string },
  lineRetry: { paddingHorizontal: 8, height: 22, borderRadius: 6, justifyContent: "center" },
  lineRetryText: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  fill: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" },
});
