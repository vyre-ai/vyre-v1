import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { States } from "../../../../ui/src/States/index.tsx";
import { BACK_TO_CONNECTIONS, completeCallback, readCallback } from "./logic.ts";
import type { CallbackParams, Outcome } from "./logic.ts";
import type { CapCall } from "../shell/session/caps.ts";

interface Props {
  /** The signed-in session's capability caller, or null when nobody is signed in to this Space in this browser. */
  call: CapCall | null;
  /** The address query the app sent the person back with. */
  search: string;
  /** Remove the code and state from the address bar and history. Called once, before anything is sent. */
  scrub(): void;
  go(path: string): void;
}

/** The signed-in page that finishes an OAuth connection. The code and state are read once, taken out of the address, and sent to the Space only as the signed-in person. */
export function OAuthCallback({ call, search, scrub, go }: Props): ReactElement {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [attempt, setAttempt] = useState(0);
  const params = useRef<CallbackParams | null>(null);
  if (params.current === null) params.current = readCallback(search);
  const started = useRef(-1);
  useEffect(() => {
    scrub();
    if (call === null || started.current === attempt) return;
    started.current = attempt;
    let alive = true;
    setOutcome(null);
    void completeCallback(call, params.current!).then((o) => { if (alive) setOutcome(o); });
    return () => { alive = false; };
  }, [attempt, call, scrub]);
  const back = <Pressable accessibilityRole="button" onPress={() => go(BACK_TO_CONNECTIONS)} testID="oauth-back" style={styles.back}><Text style={styles.backText}>Back to Connections</Text></Pressable>;
  let body: ReactElement;
  if (call === null) body = <States kind="error" message="Sign in to this Space first" cause="This page finishes a connection as the person who started it, and nobody is signed in here." next="Sign in, open Connections and connect the account again. The link you came from cannot be reused." />;
  else if (outcome === null) body = <States kind="empty" title="Finishing the connection…" icon="search" />;
  else if (outcome.kind === "connected") body = <States kind="empty" title="Account connected" icon="done" action={{ label: "Open Connections", onPress: () => go(BACK_TO_CONNECTIONS) }} />;
  else if (outcome.kind === "declined") body = <States kind="error" message="The connection was declined" cause="You did not allow access, so nothing was connected." next="Open Connections and connect the account again if you want to." />;
  else body = <States kind="error" message={outcome.message} cause={outcome.cause} next={outcome.next} retryable={outcome.retryable} onRetry={() => setAttempt((n) => n + 1)} {...(outcome.code ? { code: outcome.code } : {})} {...(outcome.traceId ? { traceId: outcome.traceId } : {})} />;
  return <View style={styles.page} testID="oauth-callback"><View style={styles.head}><Text style={styles.title}>Connecting an account</Text>{outcome?.kind === "connected" ? null : back}</View><View style={styles.body}>{body}</View></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 480, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { color: "var(--ink)" as string, fontSize: 15, fontWeight: "600" },
  back: { height: 30, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center" },
  backText: { color: "var(--ink-2)" as string, fontSize: 13, fontWeight: "500" },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
});
