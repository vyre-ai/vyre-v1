// The Apps place in the shell (spec 3.6): sites, forms, campaigns, templates and sending domains over the Space's data. The runtime's screens, calls and door become the place's AppsData;
// where a click leaves the place it goes out through the shell. A Personal Space has no Apps (spec 2.1), so the place says it needs a Team Space. Before the runtime exists the place draws its frame.
import { useMemo } from "react";
import type { ReactElement } from "react";
import AppsLayout, { AppsLoading } from "../../places/apps/shell/index.ts";
import type { AppsData } from "../../places/apps/shell/index.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

const SCREEN: Readonly<Record<string, string>> = { sites: "apps.site-editor", forms: "apps.form-settings", campaigns: "apps.campaign-builder", templates: "apps.templates", domains: "apps.sending-domains" };

export function appsData(rt: ShellRuntime): AppsData {
  return {
    screens: rt.screens, call: rt.call, clock: () => ({ now: rt.clock().now }), team: rt.space.kind === "team",
    nav: {
      open: (group, id) => rt.open({ screen: SCREEN[group] ?? "apps.forms", subject: { type: group === "sites" ? "site" : group === "forms" ? "form" : group === "campaigns" ? "campaign" : "template", id } }),
      create: (group, kind) => rt.open({ screen: SCREEN[group] ?? "apps.forms", args: { create: true, ...(kind ? { kind } : {}) } }),
      joinTeam: () => rt.open({ screen: "settings.page", args: { page: "spaces" } }),
      openTask: (taskId) => rt.open({ subject: { type: "task", id: taskId } }),
      openThread: (threadId) => rt.open({ subject: { type: "thread", id: threadId } }),
    },
  };
}

export default function AppsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const data = useMemo(() => (rt ? appsData(rt) : null), [rt]);
  return data ? <AppsLayout data={data} /> : <AppsLoading />;
}
