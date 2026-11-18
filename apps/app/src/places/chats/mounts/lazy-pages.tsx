// The pages of the Chats place that a visit opens only on request: the agent form, a task and the task list, a goal, a project. Each is loaded the first time it is drawn (r39: statically imported they were about
// 570 KB of source in front of the first signed-in screen, whichever chat was opening). Notes stays in the place's own file: a note started from Files hands its intent to the page as it mounts (w-first walk part c). The wrappers keep each page's props.
// Once a page's code has arrived it draws at once, without a Suspense frame: preloadChatsPages() fetches them all (after the first screen, and in tests that draw a page in one pass).
import { Suspense, lazy } from "react";
import type { ComponentProps, ComponentType, ReactElement } from "react";
import type { AgentForm as AgentFormView } from "../agentform/AgentForm.tsx";
import type { GoalPage as GoalPageView } from "../goals/GoalPage.tsx";
import type { ProjectScreen as ProjectScreenView } from "../projects/ProjectScreen.tsx";
import type { TaskDetail as TaskDetailView } from "../tasks/TaskDetail.tsx";
import type { TasksPage as TasksPageView } from "../tasks/TasksPage.tsx";

/** A page loaded on first draw; once loaded it is drawn directly. */
function lazyPage<P extends object>(
  load: () => Promise<ComponentType<P>>,
): {
  Draw: (props: P) => ReactElement;
  preload: () => Promise<void>;
} {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = (): Promise<ComponentType<P>> =>
    (pending ??= load().then((c) => {
      loaded = c;
      return c;
    }));
  const Lazy = lazy(() => get().then((c) => ({ default: c })));
  function Draw(props: P): ReactElement {
    const Loaded = loaded;
    if (Loaded) return <Loaded {...props} />;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return { Draw, preload: () => get().then(() => undefined) };
}

const form = lazyPage<ComponentProps<typeof AgentFormView>>(() =>
  import("../agentform/AgentForm.tsx").then((m) => m.AgentForm),
);
const goal = lazyPage<ComponentProps<typeof GoalPageView>>(() =>
  import("../goals/GoalPage.tsx").then((m) => m.GoalPage),
);
const project = lazyPage<ComponentProps<typeof ProjectScreenView>>(() =>
  import("../projects/ProjectScreen.tsx").then((m) => m.ProjectScreen),
);
const task = lazyPage<ComponentProps<typeof TaskDetailView>>(() =>
  import("../tasks/TaskDetail.tsx").then((m) => m.TaskDetail),
);
const tasks = lazyPage<ComponentProps<typeof TasksPageView>>(() =>
  import("../tasks/TasksPage.tsx").then((m) => m.TasksPage),
);

export const AgentForm = form.Draw;
export const GoalPage = goal.Draw;
export const ProjectScreen = project.Draw;
export const TaskDetail = task.Draw;
export const TasksPage = tasks.Draw;

/** Fetch every page of this file; after it resolves each draws at once. */
export function preloadChatsPages(): Promise<void> {
  return Promise.all([form, goal, project, task, tasks].map((p) => p.preload())).then(() => undefined);
}
