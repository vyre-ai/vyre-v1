// The pages of the Chats place that a visit opens only on request: the agent form, a task and the task list, a goal, a project. Each is loaded the first time it is drawn (r39: statically imported they were about
// 570 KB of source in front of the first signed-in screen, whichever chat was opening). Notes stays in the place's own file: a note started from Files hands its intent to the page as it mounts (w-first walk part c). The wrappers keep each page's props.
// Once a page's code has arrived it draws at once, without a Suspense frame: preloadChatsPages() fetches them all (after the first screen, and in tests that draw a page in one pass).
import type { ComponentProps, ReactElement } from "react";
import { crewPaneShows, useCrew } from "../crew/context.tsx";
import { Quiet } from "../../../../../../ui/src/States/Quiet.tsx";
import { lazyPage } from "./lazy-page.tsx";
import type { AgentForm as AgentFormView } from "../agentform/AgentForm.tsx";
import type { GoalPage as GoalPageView } from "../goals/GoalPage.tsx";
import type { ProjectScreen as ProjectScreenView } from "../projects/ProjectScreen.tsx";
import type { TaskDetail as TaskDetailView } from "../tasks/TaskDetail.tsx";
import type { NotesPage as NotesPageView } from "../notes/NotesPage.tsx";
import type { TasksPage as TasksPageView } from "../tasks/TasksPage.tsx";
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
// AgentInTrash is small (2 KB) and is on the first frame of every agent page: it stays in the place's own code, so an agent page never draws blank while a chunk arrives.
export { AgentInTrash } from "../agentpage/AgentInTrash.tsx";
// The Crew pane is drawn only while it is open: its light wrapper (the gate, shared with the pane through crewPaneShows) is always there and returns what was on the right until then; the pane itself
// loads when it is first open, and what was on the right stands in until it has arrived.
const crewSideBody = lazyPage<ComponentProps<typeof CrewSideView>>(
  () => import("../crew/CrewSide.tsx").then((m) => m.CrewSide),
  (p) => p.fallback,
);
export function CrewSide(props: ComponentProps<typeof CrewSideView>): ReactElement | null {
  return crewPaneShows(useCrew()) ? <crewSideBody.Draw {...props} /> : props.fallback;
}
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

// Notes carries the collaborative editor (yjs and the rich editor, about 80 KB sent): out of the first signed-in screen. What a note started elsewhere hands the page is in its props, not in a mount-time side channel.
const notesPage = lazyPage<ComponentProps<typeof NotesPageView>>(
  () => import("../notes/NotesPage.tsx").then((m) => m.NotesPage),
  () => <Quiet delay={0} testID="notes-loading" />, // a note opened from a link or the sidebar shows the mark at once, never an empty frame
);
export const NotesPage = notesPage.Draw;

/** Fetch every page of this file; after it resolves each draws at once. */
export function preloadChatsPages(): Promise<void> {
  return Promise.all(
    [
      form,
      goal,
      project,
      task,
      tasks,
      crewSideBody,
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
      notesPage,
    ].map((p) => p.preload()),
  ).then(() => undefined);
}
