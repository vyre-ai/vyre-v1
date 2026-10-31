// A task a Run made, opened in the side pane of Automations (work baton, lane W2): the same task page as Home, with its stepper, brief, deliverable and baton buttons, over the Home data.
import type { ReactElement } from "react";
import { HomeDataProvider } from "../../places/home/index.tsx";
import { TaskLeaf } from "../../places/home/task/TaskLeaf.tsx";
import { homeData } from "./home.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function SideTask({ rt, taskId, onBack, onOpen }: { rt: ShellRuntime; taskId: string; onBack(): void; onOpen(type: string, id: string): void }): ReactElement {
  return <HomeDataProvider value={homeData(rt)}><TaskLeaf taskId={taskId} onBack={onBack} onOpen={onOpen} /></HomeDataProvider>;
}
