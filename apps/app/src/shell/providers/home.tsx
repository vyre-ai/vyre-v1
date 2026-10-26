// Home in the shell (spec 3.1, 2.1): the data provider over the Space's replica and the variant by Space kind.
// A Team Space draws the whole page: checklist, Needs you, My work, Projects at risk, While you were away, Routines, then Today, Starred and the Ask box.
// A Personal Space draws only the personal variant: checklist, Today, Starred and the Ask box. Needs you and My work need a team to ask and assign, so they are not on the page.
import { useMemo } from "react";
import type { ReactElement } from "react";
import Home, { HomeLoading } from "../../places/home/index.tsx";
import type { HomeData, HomeNav } from "../../places/home/sections-a/index.ts";
import { homeBSlots } from "../../places/home/sections-b/index.ts";
import type { GoTarget, HomeBExtras } from "../../places/home/sections-b/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime, ShellTarget } from "./runtime.tsx";

/** Where each checklist or quick-start button leads. */
export const GO_TARGETS: Record<GoTarget, ShellTarget> = {
  ai: { screen: "settings.models-usage" },
  photo_and_title: { screen: "settings.page", args: { page: "profile" } },
  connect_mailbox_and_calendar: { screen: "mail.connections" },
  meet_assistant: { screen: "chats.conversation", args: { with: "assistant" } },
  open_first_project: { screen: "records.projects" },
  import: { screen: "records.import" },
  new_project: { screen: "records.projects", args: { create: true } },
  new_record: { screen: "records.saved-views", args: { create: true } },
  upload: { screen: "files.list", args: { upload: true } },
  team_space: { screen: "spaces.switcher", args: { create: "team" } },
};

export function homeNav(rt: ShellRuntime): HomeNav {
  return {
    openTask: (taskId) => rt.open({ screen: "tasks.page", args: { taskId } }),
    openRecord: (recordId) => rt.open({ subject: { type: "record", id: recordId } }),
    openRun: (runId) => rt.open({ subject: { type: "run", id: runId } }),
    openNeedsYou: (taskId) => rt.open({ screen: "tasks.needs-you", ...(taskId ? { args: { taskId } } : {}) }),
    openMyWork: () => rt.open({ screen: "tasks.my-work" }),
    openActivity: () => rt.open({ screen: "runs.my-runs" }),
    openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
    openSubject: (subject) => rt.open({ subject }),
  };
}

export function homeData(rt: ShellRuntime): HomeData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, principals: rt.principals, recordTitle: rt.recordTitle, me: rt.me, clock: rt.clock,
    nav: homeNav(rt),
  };
}

export function homeExtras(rt: ShellRuntime): HomeBExtras {
  return {
    space: { kind: rt.space.kind, name: rt.space.name },
    assistant: rt.assistant,
    get aiConnected() { return rt.aiConnected; },
    calendarConnected: rt.calendarConnected,
    go: (target) => rt.open(GO_TARGETS[target]),
    openUrl: (url) => rt.openUrl(url),
  };
}

/** The Home place the shell mounts. Before the Space's runtime exists it draws the loading frame, the size of the page. */
export default function HomePlace(): ReactElement {
  const rt = useOptionalShellRuntime();
  const parts = useMemo(() => {
    if (!rt) return null;
    const data = homeData(rt);
    const slots = homeBSlots(homeExtras(rt));
    return { data, top: slots.top as ReactElement, bottom: slots.bottom as ReactElement, personal: rt.space.kind === "personal" };
  }, [rt]);
  if (!parts) return <HomeLoading />;
  return <Home data={parts.data} top={parts.top} bottom={parts.bottom} personal={parts.personal} />;
}
