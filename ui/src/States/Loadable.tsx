// Loadable: the one wrapper that turns a read into the four things a person can see: the quiet mark while it waits, a plain error with Retry, a real empty state, or the content.
// A place never decides this alone, and an error is never left out: a read that failed is `failed` here, so it cannot sit behind an endless "Loading".
// The pieces are the ones that already exist: Quiet (calm loading), LoadFailed (the error: whatever it decides about Retry for a refused read applies here too, there is no second rule in this file) and States kind=empty.
import type { ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { States } from "./index.tsx";
import { LoadFailed, retryLoads } from "./Loads.tsx";
import type { LoadFailure } from "./Loads.tsx";
export { CANNOT_READ } from "./retry.ts";
import { Quiet } from "./Quiet.tsx";
import type { StateAction, StateIcon } from "./props.ts";

/** What a read is doing. `stale`: the last re-read failed and the old answer stays, with a quiet "Couldn't refresh. Retry". */
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
  /** The way out of a refusal, if this place can take a person somewhere (Chats). Absent: a refusal draws no button. */
  back?: { label: string; onPress: () => void };
  children(data: T): ReactNode;
}

export function Loadable<T>({ load, what, isEmpty, empty, loading, back, children }: LoadableProps<T>): ReactElement {
  if (load.state === "loading") return <>{loading ?? <Quiet />}</>;
  if (load.state === "failed")
    return <LoadFailed what={what} failure={load.failure} onRetry={load.retry} {...(back ? { back } : {})} />;
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
      {load.stale ? <StaleLine /> : null}
      {children(load.data)}
    </>
  );
}

/** "Couldn't refresh. Retry" floats at the top right of what it sits over: it appears and goes without moving anything a person is reading or typing in. */
function StaleLine(): ReactElement {
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    if (!trying) return undefined;
    // the retry is on its way: say so for a moment, then the line is back with its Retry (a retry that fails again leaves the same note)
    const t = setTimeout(() => setTrying(false), 1500);
    return () => clearTimeout(t);
  }, [trying]);
  return (
    <View
      testID="load-stale"
      style={st.stale}
      {...(Platform.OS === "web" ? ({ role: "status", "aria-live": "polite" } as object) : {})}
    >
      <Text style={st.line}>{trying ? "Trying again…" : "Couldn't refresh."}</Text>
      {trying ? null : (
        <Pressable
          accessibilityRole="button"
          testID="load-stale-retry"
          onPress={() => {
            setTrying(true);
            retryLoads();
          }}
        >
          <Text style={st.retry}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  stale: {
    position: "absolute",
    top: 6,
    right: 12,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "var(--raised)" as string,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  line: { fontSize: 12.5, color: "var(--ink-3)" as string },
  retry: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
