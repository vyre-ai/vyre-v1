// Loadable: the one wrapper that turns a read into the four things a person can see: the quiet mark while it waits, a plain error with Retry, a real empty state, or the content.
// A place never decides this alone, and an error is never left out: a read that failed is `failed` here, so it cannot sit behind an endless "Loading".
// The pieces are the ones that already exist: Quiet (calm loading), LoadFailed (the error: whatever it decides about Retry for a refused read applies here too, there is no second rule in this file) and States kind=empty.
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { States } from "./index.tsx";
import { LoadFailed } from "./Loads.tsx";
import type { LoadFailure } from "./Loads.tsx";
import { Quiet } from "./Quiet.tsx";
import type { StateAction, StateIcon } from "./props.ts";

/** What a read is doing. */
export type Load<T> =
  | { state: "loading" }
  | { state: "failed"; failure: LoadFailure; retry(): void }
  | { state: "ready"; data: T };

/** The code of a failure that trying again cannot fix (hooks that cannot answer this read at all): the words are shown and there is no Retry. */
export const CANNOT_READ = "load.cannot_read";

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
  if (load.state === "failed")
    return load.failure.code === CANNOT_READ ? (
      <View testID="load-failed" style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" }}>
        <States kind="error" message={`Couldn't load ${what}`} cause={load.failure.message} />
      </View>
    ) : (
      <LoadFailed what={what} failure={load.failure} onRetry={load.retry} />
    );
  if (isEmpty?.(load.data) === true)
    return (
      <States
        kind="empty"
        title={empty?.title ?? `No ${what} yet`}
        {...(empty?.icon ? { icon: empty.icon } : {})}
        {...(empty?.action ? { action: empty.action } : {})}
      />
    );
  return <>{children(load.data)}</>;
}
