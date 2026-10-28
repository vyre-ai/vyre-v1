// The Apps place in the shell (spec 3.6): sites, forms, campaigns, templates and sending domains over the Space's data. The runtime's screens, calls and door become the place's AppsData;
// where a click leaves the place it goes out through the shell. A Personal Space has no Apps (spec 2.1), so the place says it needs a Team Space. Before the runtime exists the place draws its frame.
import { useMemo } from "react";
import type { ReactElement } from "react";
import AppsLayout, { AppsLoading } from "../../places/apps/shell/index.ts";
import type { AppsData, AppsRoute } from "../../places/apps/shell/index.ts";
import { usePlaceHash } from "../hash/context.tsx";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

const SCREEN: Readonly<Record<string, string>> = { sites: "apps.site-editor", forms: "apps.form-settings", campaigns: "apps.campaign-builder", templates: "apps.templates", domains: "apps.sending-domains" };

export { appsRoute } from "../../places/apps/shell/routes.ts";
import { appsRoute } from "../../places/apps/shell/routes.ts";

export function appsData(rt: ShellRuntime): AppsData {
  const deferred = new Set(rt.deferredModules);
  deferred.add("sites");
  return {
    me: { id: rt.me.id, name: rt.me.name }, connection: rt.connection,
    screens: rt.screens, call: rt.call, clock: () => ({ now: rt.clock().now }), team: rt.space.kind === "team", deferred: [...deferred],
    nav: {
      open: (group, id) => rt.open({ screen: SCREEN[group] ?? "apps.forms", args: { selected: id } }),
      create: (group, kind) => rt.open({ screen: group === "forms" ? "apps.forms" : group === "campaigns" ? "apps.campaigns" : group === "domains" ? "apps.sending-domains" : SCREEN[group] ?? "apps.forms", args: { create: true, ...(kind ? { kind } : {}) } }),
      show: (group) => rt.open({ screen: group === "forms" ? "apps.forms" : group === "campaigns" ? "apps.campaigns" : group === "domains" ? "apps.sending-domains" : SCREEN[group] ?? "apps.forms" }),
      joinTeam: () => rt.open({ screen: "settings.page", args: { page: "spaces" } }),
      openTask: (taskId) => rt.open({ subject: { type: "task", id: taskId } }),
      openThread: (threadId) => rt.open({ subject: { type: "thread", id: threadId } }),
    },
  };
}

export default function AppsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const { target } = usePlaceHash();
  const data = useMemo(() => (rt ? appsData(rt) : null), [rt]);
  const route = useMemo(() => appsRoute(target), [target]);
  const start = route.kind === "list" ? { ...(route.group ? { group: route.group } : {}) } : { group: route.group, selected: route.kind === "detail" ? route.id : undefined, open: true };
  return data ? <AppsLayout data={data} start={start} route={route} /> : <AppsLoading />;
}
