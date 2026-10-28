import { useEffect, useState } from "react";
import type { ComponentType, ReactElement } from "react";
import { Text, View } from "react-native";
import { States } from "../../../../../../ui/src/States/index.tsx";
interface Props { taskId: string; onBack(): void; onOpen(type: string, id: string): void }
/** Task detail is loaded only when opened, keeping Home's startup independent. */
export function TaskLeaf(props: Props): ReactElement {
  const [Route, setRoute] = useState<ComponentType<Props> | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setError("");
    void import("./TaskRoute.tsx").then((module) => { if (live) setRoute(() => module.TaskRoute); }, (failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : "Couldn't load the task page."); });
    return () => { live = false; };
  }, [attempt]);
  if (Route) return <Route key={props.taskId} {...props} />;
  return <View testID="task-page-loading" style={{ flex: 1, padding: 28 }}>{error ? <States kind="error" message={error} retryable onRetry={() => setAttempt((value) => value + 1)} /> : <Text style={{ color: "var(--ink-3)" as string }}>Opening task…</Text>}</View>;
}
