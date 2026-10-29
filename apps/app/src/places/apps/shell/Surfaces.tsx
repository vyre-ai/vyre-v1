// Every incoming Apps route mounts the same capability-backed editor used by New and Open.
import type { ReactElement } from "react";
import type { AppsRoute } from "./AppsPlace.tsx";
import { useAppsData } from "./data.tsx";
import { FormEditor } from "./FormEditor.tsx";
import { CampaignEditor } from "./CampaignEditor.tsx";
import { TemplateEditor } from "./TemplateEditor.tsx";
import { DomainEditor } from "./DomainEditor.tsx";
export function AppsSurface({ route }: { route: Exclude<AppsRoute, { kind: "list" }> }): ReactElement {
  const d = useAppsData();
  const target = { group: route.group, ...(route.kind === "detail" ? { id: route.id } : { create: true }) };
  const back = (): void => d.nav.show(route.group);
  switch (route.group) {
    case "forms": return <FormEditor route={target} back={back} />;
    case "campaigns": return <CampaignEditor route={target} back={back} />;
    case "templates": return <TemplateEditor route={target} back={back} />;
    case "domains": return <DomainEditor route={target} back={back} />;
  }
}
