// The Overview tab body (lane l-editor). The shell (l-chrome2a) mounts ProjectOverview(props: ProjectTabProps) as the Overview tab: a Notion-like page that people and agents both edit, in the shared
// Markdown editor with live blocks, a properties row, templates, history with Undo. It reads the rest from the page's data (call, nameOf, now, nav) and navigates only through data.nav.
import type { ReactElement } from "react";
import type { ProjectTabProps } from "../tabs.ts";
import { OverviewPage } from "./OverviewPage.tsx";

export function ProjectOverview({ projectId, canEdit }: ProjectTabProps): ReactElement {
  return <OverviewPage projectId={projectId} canEdit={canEdit} />;   // the page does not need the Space id
}
export { OverviewPage } from "./OverviewPage.tsx";
export type { OverviewPageProps } from "./OverviewPage.tsx";
export * from "./model.ts";
