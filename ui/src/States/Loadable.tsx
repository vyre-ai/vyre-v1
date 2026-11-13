// Loadable: the one wrapper that turns a read into the four things a person can see: the quiet mark while it waits, a plain error with Retry, a real empty state, or the content.
// A place never decides this alone, and an error is never left out: a read that failed is `failed` here, so it cannot sit behind an endless "Loading".
// The pieces are the ones that already exist: Quiet (calm loading), LoadFailed (the error, and the rule that a refused read has no Retry) and States kind=empty.
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { States } from "./index.tsx";
import { LoadFailed, retryLoads } from "./Loads.tsx";
import type { LoadFailure } from "./Loads.tsx";
import { Quiet } from "./Quiet.tsx";
import type { StateAction, StateIcon } from "./props.ts";

/** What a read is doing. `stale`: the last re-read failed and the old answer stays. */
export type Load<T> =
  | { state: "loading" }
  | { state: "failed"; failure: LoadFailure; retry(): void }
  | { state: "ready"; data: T; stale?: LoadFailure };

export interface LoadableProps<T> {
  load: Load<T>;
  /** What is being loaded, in the words of "Couldn't load <what>" and "No <what> yet": "the Inbox", "settings". */
  what: string;
  /** True when a ready answer holds nothing to show. Absent: ready always draws its content. */
  isEmpty?(data: T): boolean;
  empty?: { title: string; icon?: StateIcon; action?: StateAction };
  /** What a place with a frame of the right size draws while it waits, instead of the quiet mark. */
  loading?: ReactNode;
  children(data: T): ReactNode;
}

export function Loadable<T>({ load, what, isEmpty, empty, loading, children }: LoadableProps<T>): ReactElement {
  if (load.state === "loading") return <>{loading ?? <Quiet />}</>;
  if (load.state === "failed") return <LoadFailed what={what} failure={load.failure} onRetry={load.retry} />;
  if (isEmpty?.(load.data) === true)
    return (
      <States
        kind="empty"
        title={empty?.title ?? `No ${what} yet`}
        {...(empty?.icon ? { icon: empty.icon } : {})}
        {...(empty?.action ? { action: empty.action } : {})}
      />
    );
  return (
    <>
      {load.stale ? (
        <View testID="load-stale" style={st.stale}>
          <Text style={st.line}>Couldn't refresh.</Text>
          <Pressable accessibilityRole="button" testID="load-stale-retry" onPress={retryLoads}>
            <Text style={st.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {children(load.data)}
    </>
  );
}

const st = StyleSheet.create({
  stale: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 6 },
  line: { fontSize: 12.5, color: "var(--ink-3)" as string },
  retry: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
