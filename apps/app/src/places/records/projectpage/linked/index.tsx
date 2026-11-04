// The Linked tab body (owner, 4 Nov 2026; lane l-artifacts). The project page mounts ProjectLinked(props: ProjectTabProps); it reads the rest from the page's data (call, nameOf, now, nav) and goes nowhere but through data.nav.
import type { ReactElement } from "react";
import { LinkedTab } from "./LinkedTab.tsx";
import { usePageTitle } from "./title.ts";
import type { ProjectTabProps } from "../tabs.ts";

export function ProjectLinked({ projectId, canEdit }: ProjectTabProps): ReactElement {
  return <LinkedTab projectId={projectId} projectTitle={usePageTitle(projectId)} canEdit={canEdit} />;
}

export { LinkedTab } from "./LinkedTab.tsx";
export type { LinkedTabProps } from "./LinkedTab.tsx";
export * from "./model.ts";
