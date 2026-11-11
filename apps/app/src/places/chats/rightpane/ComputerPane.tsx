// The Computer tab, one component for every place that shows it (the chat's pane and an agent's page): Terminal plus Browser (WorkSections) once the workspace and the Space browser are bound, which is
// always in the app (owner ruling 6 Nov 2026, DESIGN-agent-workspaces.md); the single desktop computer tab only where neither is bound (samples and tests).
import type { ReactElement } from "react";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { PaneDeps } from "./actions.ts";
import { ComputerTab } from "./ComputerTab.tsx";
import { usePaneData } from "./data.tsx";
import { WorkSections, usesWorkModel } from "./WorkSections.tsx";

export function ComputerPane({ deps, window }: { deps: PaneDeps; window?: VirtualWindow | undefined }): ReactElement {
  const data = usePaneData();
  return usesWorkModel(data) ? <WorkSections deps={deps} {...(window ? { window } : {})} /> : <ComputerTab deps={deps} {...(window ? { window } : {})} />;
}
