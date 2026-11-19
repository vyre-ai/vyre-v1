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
import type { AgentInTrash as AgentInTrashView } from "../agentpage/AgentInTrash.tsx";
import type { CrewSide as CrewSideView } from "../crew/CrewSide.tsx";
import type { TerminalList as TerminalListView } from "../terminal/TerminalList.tsx";
import type { TerminalRules as TerminalRulesView } from "../terminal/TerminalRules.tsx";
import type { TerminalTab as TerminalTabView } from "../terminal/TerminalTab.tsx";
import type { AllAgents as AllAgentsView } from "./AllAgents.tsx";
import type { ArtifactsPage as ArtifactsPageView } from "./ArtifactsPage.tsx";
import type { ArtifactView as ArtifactViewView } from "./ArtifactView.tsx";
import type { ReplyDetailsPane as ReplyDetailsPaneView } from "../details/ReplyDetailsPane.tsx";
import type { ThingPane as ThingPaneView } from "./ThingPane.tsx";
import type { AgentShareHost as AgentShareHostView } from "../agentform/AgentShare.tsx";
import type { ProjectChatGate as ProjectChatGateView } from "../projects/ProjectChatGate.tsx";
import type { PhoneProfile as PhoneProfileView } from "./PhoneProfile.tsx";

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

// Parts a person opens on request (r41: out of the first signed-in screen's source)
const agentInTrashPage = lazyPage<ComponentProps<typeof AgentInTrashView>>(() =>
  import("../agentpage/AgentInTrash.tsx").then((m) => m.AgentInTrash),
);
export const AgentInTrash = agentInTrashPage.Draw;
const crewSidePage = lazyPage<ComponentProps<typeof CrewSideView>>(() =>
  import("../crew/CrewSide.tsx").then((m) => m.CrewSide),
);
export const CrewSide = crewSidePage.Draw;
const terminalListPage = lazyPage<ComponentProps<typeof TerminalListView>>(() =>
  import("../terminal/TerminalList.tsx").then((m) => m.TerminalList),
);
export const TerminalList = terminalListPage.Draw;
const terminalRulesPage = lazyPage<ComponentProps<typeof TerminalRulesView>>(() =>
  import("../terminal/TerminalRules.tsx").then((m) => m.TerminalRules),
);
export const TerminalRules = terminalRulesPage.Draw;
const terminalTabPage = lazyPage<ComponentProps<typeof TerminalTabView>>(() =>
  import("../terminal/TerminalTab.tsx").then((m) => m.TerminalTab),
);
export const TerminalTab = terminalTabPage.Draw;
const allAgentsPage = lazyPage<ComponentProps<typeof AllAgentsView>>(() =>
  import("./AllAgents.tsx").then((m) => m.AllAgents),
);
export const AllAgents = allAgentsPage.Draw;
const artifactsPagePage = lazyPage<ComponentProps<typeof ArtifactsPageView>>(() =>
  import("./ArtifactsPage.tsx").then((m) => m.ArtifactsPage),
);
export const ArtifactsPage = artifactsPagePage.Draw;
const artifactViewPage = lazyPage<ComponentProps<typeof ArtifactViewView>>(() =>
  import("./ArtifactView.tsx").then((m) => m.ArtifactView),
);
export const ArtifactView = artifactViewPage.Draw;
const replyDetailsPanePage = lazyPage<ComponentProps<typeof ReplyDetailsPaneView>>(() =>
  import("../details/ReplyDetailsPane.tsx").then((m) => m.ReplyDetailsPane),
);
export const ReplyDetailsPane = replyDetailsPanePage.Draw;
const thingPanePage = lazyPage<ComponentProps<typeof ThingPaneView>>(() =>
  import("./ThingPane.tsx").then((m) => m.ThingPane),
);
export const ThingPane = thingPanePage.Draw;
const agentShareHostPage = lazyPage<ComponentProps<typeof AgentShareHostView>>(() =>
  import("../agentform/AgentShare.tsx").then((m) => m.AgentShareHost),
);
export const AgentShareHost = agentShareHostPage.Draw;
const projectChatGatePage = lazyPage<ComponentProps<typeof ProjectChatGateView>>(() =>
  import("../projects/ProjectChatGate.tsx").then((m) => m.ProjectChatGate),
);
export const ProjectChatGate = projectChatGatePage.Draw;
const phoneProfilePage = lazyPage<ComponentProps<typeof PhoneProfileView>>(() =>
  import("./PhoneProfile.tsx").then((m) => m.PhoneProfile),
);
export const PhoneProfile = phoneProfilePage.Draw;

/** Fetch every page of this file; after it resolves each draws at once. */
export function preloadChatsPages(): Promise<void> {
  return Promise.all(
    [
      form,
      goal,
      project,
      task,
      tasks,
      agentInTrashPage,
      crewSidePage,
      terminalListPage,
      terminalRulesPage,
      terminalTabPage,
      allAgentsPage,
      artifactsPagePage,
      artifactViewPage,
      replyDetailsPanePage,
      thingPanePage,
      agentShareHostPage,
      projectChatGatePage,
      phoneProfilePage,
    ].map((p) => p.preload()),
  ).then(() => undefined);
}
