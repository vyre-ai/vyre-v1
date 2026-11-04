// A project, in its own Chats tab: the one project page (records/projectpage) with the shell's data behind it. Records and Chats draw the same page; this only feeds it.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { InProjectFrame } from "../conversation/frame.ts";
import { ProjectPage } from "../../records/projectpage/ProjectPage.tsx";
import { ProjectPageDataProvider } from "../../records/projectpage/data.tsx";
import { isProjectTab } from "../../records/projectpage/tabs.ts";
import type { ProjectTabKey } from "../../records/projectpage/tabs.ts";
import { projectPageData } from "../../../shell/providers/project-data.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

export function ProjectScreen({ rt, projectId, tab, onTab, chatSlot }: { rt: ShellRuntime; projectId: string; tab: string | null; onTab(tab: ProjectTabKey): void; chatSlot?: ReactElement | null }): ReactElement {
  const data = useMemo(() => projectPageData(rt), [rt]);
  return (
    <ProjectPageDataProvider value={data}>
      <ProjectPage projectId={projectId} {...(isProjectTab(tab) ? { tab } : {})} onTabChange={onTab} {...(chatSlot ? { chatSlot: <InProjectFrame value>{chatSlot}</InProjectFrame> } : {})} space={{ id: rt.space.id, kind: rt.space.kind, name: rt.space.name }} />
    </ProjectPageDataProvider>
  );
}
