// Nothing sits on a loading mark for ever. Every place that loads draws one of two things: the quiet mark while it waits, or, the moment a read fails, a plain error with Retry.
// A read that fails keeps the query in `loading` with the reason in `error` (client QueryState), so "still loading" and "failed" are told apart here, in one place, not by each screen.
// Retry asks the Space's session to read again what is on screen: it sends RETRY_LOADS_EVENT, which the session answers by re-reading every watched query.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { States } from "./index.tsx";

export { RETRY_LOADS_EVENT, failureOf, onRetryLoads, retryLoads } from "./retry.ts";
export type { LoadFailure } from "./retry.ts";
import { retryLoads } from "./retry.ts";
import type { LoadFailure } from "./retry.ts";

/** The error a place draws where its content would be: "Couldn't load <what>", the reason, Retry, and the trace id behind Details. */
export function LoadFailed({ what, failure, onRetry = retryLoads, testID = "load-failed" }: { what: string; failure: LoadFailure; onRetry?: () => void; testID?: string }): ReactElement {
  return (
    <View testID={testID} style={st.fill}>
      <States kind="error" message={`Couldn't load ${what}`} cause={failure.message} {...(failure.code ? { code: failure.code } : {})} {...(failure.traceId ? { traceId: failure.traceId } : {})} retryable onRetry={onRetry} />
    </View>
  );
}

const st = StyleSheet.create({ fill: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" } });
