// The tabs of a project page and the one shape every tab body takes (lane l-chrome2a owns the shell, 4 Nov). The page is one screen in Chats, opened as its own tab; it draws the header, this tab row,
// and the body of the selected tab. A body is a component with these props and reads the rest from usePageData() (data.tsx: call, nameOf, now, nav). Bodies never navigate by themselves: they call
// data.nav, which goes through the shell's one door.
//   Chat      projectpage/ProjectPage.tsx (the project's channel, with thread replies from chats/thread-replies/*, l-addsheet)
//   Plan      projectpage/ProjectPage.tsx (the shared Plan)
//   Overview  projectpage/overview/index.tsx   export function ProjectOverview(props: ProjectTabProps)   (l-editor)
//   Linked    projectpage/linked/index.tsx     export function ProjectLinked(props: ProjectTabProps)     (l-artifacts)
//   Knows     projectpage/KnowsTab.tsx         the shell mounts ui/Knows with memory.place.list (l-chrome2a)
import type { ReactElement } from "react";

export const PROJECT_TABS = [
  { key: "chat", title: "Chat" },
  { key: "plan", title: "Plan" },
  { key: "overview", title: "Overview" },
  { key: "linked", title: "Linked" },
] as const;
export type ProjectTabKey = (typeof PROJECT_TABS)[number]["key"];
export const DEFAULT_PROJECT_TAB: ProjectTabKey = "chat";
export const isProjectTab = (v: unknown): v is ProjectTabKey => PROJECT_TABS.some((t) => t.key === v);

/** The Space the page is in. */
export interface ProjectSpace { id: string; kind: "team" | "personal"; name: string }

/** What a tab body receives. `canEdit`: the person may change this project (Edit or Manage on it); `admin`: the person is an admin of the Space (the Console is theirs). A body shows no control they cannot use. */
export interface ProjectTabProps { projectId: string; space: ProjectSpace; canEdit: boolean; admin: boolean }
export type ProjectTabBody = (props: ProjectTabProps) => ReactElement | null;
