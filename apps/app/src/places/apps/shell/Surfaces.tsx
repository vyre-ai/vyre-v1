// Every incoming Apps route mounts the same capability-backed editor used by New and Open.
import type { ReactElement } from "react";
import { View } from "react-native";
import type { AppsRoute } from "./AppsPlace.tsx";
import { useAppsData } from "./data.tsx";
import { FormEditor } from "./FormEditor.tsx";
import { TemplateEditor } from "./TemplateEditor.tsx";
import { DomainEditor } from "./DomainEditor.tsx";
import { EmailDesigner } from "./EmailDesigner.tsx";
import { SiteDetail } from "./SiteDetail.tsx";
export function AppsSurface({ route }: { route: Exclude<AppsRoute, { kind: "list" }> }): ReactElement {
  const d = useAppsData();
  const back = (): void => d.nav.show(route.group);
  if (route.kind === "artifacts") return <View />;
  if (route.kind === "email") return <EmailDesigner id={route.id} back={back} />;
  if (route.group === "sites") return route.kind === "detail" ? <SiteDetail id={route.id} back={back} /> : <View />;
  const target = { group: route.group, ...(route.kind === "detail" ? { id: route.id } : { create: true }) };
  switch (route.group) {
    case "forms":
      // one editor per form: unsaved edits of one form never hold back the fields of the next (a keyed editor starts empty and fills from its own form)
      return <FormEditor key={"id" in target ? target.id : "new"} route={target} back={back} />;
    case "templates":
      return <TemplateEditor route={target} back={back} />;
    case "domains":
      return <DomainEditor route={target} back={back} />;
  }
}
