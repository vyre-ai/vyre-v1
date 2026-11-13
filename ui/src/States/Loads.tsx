// Nothing sits on a loading mark for ever. Every place that loads draws one of two things: the quiet mark while it waits, or, the moment a read fails, a plain error with Retry.
// A read that fails keeps the query in `loading` with the reason in `error` (client QueryState), so "still loading" and "failed" are told apart here, in one place, not by each screen.
// Retry asks the Space's session to read again what is on screen: it sends RETRY_LOADS_EVENT, which the session answers by re-reading every watched query.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { States } from "./index.tsx";

export { BACK_LABEL, BACK_TO_START_EVENT, REFUSED_CAUSE, RETRY_LOADS_EVENT, backToStart, failureOf, isRefused, onBackToStart, onRetryLoads, refusalFinal, retryLoads } from "./retry.ts";
export type { LoadFailure } from "./retry.ts";
import { BACK_LABEL, REFUSED_CAUSE, backToStart, isRefused, retryLoads } from "./retry.ts";
import type { LoadFailure } from "./retry.ts";

/** The error a place draws where its content would be: "Couldn't load <what>", the reason, Retry, and the trace id behind Details. */
export function LoadFailed({ what, failure, onRetry = retryLoads, testID = "load-failed", refusable = true }: { what: string; failure: LoadFailure; onRetry?: () => void; testID?: string; /** False where a person cannot be refused (the list of what needs them): the read failed, so Retry stays. */ refusable?: boolean }): ReactElement {
  // a refusal is not a failure to wait out: say so plainly and offer no Retry, which could never work
  if (refusable && isRefused(failure)) return <View testID={testID} style={st.fill}><States kind="error" message={`You can't open ${what}`} cause={REFUSED_CAUSE} action={{ label: BACK_LABEL, onPress: backToStart }} {...(failure.traceId ? { traceId: failure.traceId } : {})} /></View>;
  return (
    <View testID={testID} style={st.fill}>
      <States kind="error" message={`Couldn't load ${what}`} cause={failure.message} {...(failure.code ? { code: failure.code } : {})} {...(failure.traceId ? { traceId: failure.traceId } : {})} retryable onRetry={onRetry} />
    </View>
  );
}

const st = StyleSheet.create({ fill: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" } });
