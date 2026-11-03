// The shell draws a place with its Ask pane beside it (ASK_SIDE). The place keeps its own tree whether the pane is open or not, so opening Ask never remounts what the person was looking at.
// The pane itself loads the first time it opens, so a place that is never asked about carries none of the chat code.
import { lazy, Suspense, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { ASK_SIDE, askPaneOf, subscribeAskPane } from "./pane.ts";

const AskPane = lazy(() => import("./AskPane.tsx").then((m) => ({ default: m.AskPane })));

export function AskPaneHost({ place, rt, children }: { place: string; rt: ShellRuntime | null; children?: ReactNode }): ReactElement {
  const read = (): ReturnType<typeof askPaneOf> => askPaneOf(place);
  const state = useSyncExternalStore(subscribeAskPane, read, read);
  const pane = state && rt ? <Suspense fallback={null}><AskPane rt={rt} state={state} /></Suspense> : null;
  return (
    <View style={st.host} testID="ask-host">
      {ASK_SIDE === "left" ? pane : null}
      <View style={st.body}>{children}</View>
      {ASK_SIDE === "right" ? pane : null}
    </View>
  );
}

const st = StyleSheet.create({
  host: { flex: 1, flexDirection: "row", minWidth: 0, minHeight: 0 },
  body: { flex: 1, minWidth: 0, minHeight: 0 },
});
