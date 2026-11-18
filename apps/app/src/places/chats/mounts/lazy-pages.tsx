// The pages of the Chats place that a visit opens only on request: the agent form, a task and the task list, a goal, a project. Notes stays in the place's own file: a new note opened from Files hands its intent to the page as it mounts (w-first walk part c). Each is loaded the first time it is drawn (r39: statically imported they were about
// 570 KB of source in front of the first signed-in screen, whichever chat was opening). The wrappers keep the page's own props.
import { Suspense, lazy } from "react";
import type { ComponentProps, ReactElement } from "react";
import type { AgentForm as AgentFormView } from "../agentform/AgentForm.tsx";
import type { GoalPage as GoalPageView } from "../goals/GoalPage.tsx";
import type { ProjectScreen as ProjectScreenView } from "../projects/ProjectScreen.tsx";
import type { TaskDetail as TaskDetailView } from "../tasks/TaskDetail.tsx";
import type { TasksPage as TasksPageView } from "../tasks/TasksPage.tsx";

const Form = lazy(() => import("../agentform/AgentForm.tsx").then((m) => ({ default: m.AgentForm })));
const Goal = lazy(() => import("../goals/GoalPage.tsx").then((m) => ({ default: m.GoalPage })));
const Project = lazy(() => import("../projects/ProjectScreen.tsx").then((m) => ({ default: m.ProjectScreen })));
const Task = lazy(() => import("../tasks/TaskDetail.tsx").then((m) => ({ default: m.TaskDetail })));
const Tasks = lazy(() => import("../tasks/TasksPage.tsx").then((m) => ({ default: m.TasksPage })));

export function AgentForm(props: ComponentProps<typeof AgentFormView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Form {...props} />
    </Suspense>
  );
}
export function GoalPage(props: ComponentProps<typeof GoalPageView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Goal {...props} />
    </Suspense>
  );
}
export function ProjectScreen(props: ComponentProps<typeof ProjectScreenView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Project {...props} />
    </Suspense>
  );
}
export function TaskDetail(props: ComponentProps<typeof TaskDetailView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Task {...props} />
    </Suspense>
  );
}
export function TasksPage(props: ComponentProps<typeof TasksPageView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Tasks {...props} />
    </Suspense>
  );
}
