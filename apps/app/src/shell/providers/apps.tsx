// The Apps place in the shell (spec 3.6): sites, forms, templates and sending domains over the Space's data. The runtime's screens, calls and door become the place's AppsData;
// where a click leaves the place it goes out through the shell. A Personal Space has no Apps (spec 2.1), so the place says it needs a Team Space. Before the runtime exists the place draws its frame.
import { openAskPane } from "../ask/pane.ts";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import AppsLayout, { AppsLoading } from "../../places/apps/shell/index.ts";
import type { AppsData, AppsRoute } from "../../places/apps/shell/index.ts";
import { usePlaceHash } from "../hash/context.tsx";
import { FolderShareSheet } from "./files-share.tsx";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";
import { nameOf } from "./misc-common.ts";
import { adminPages, adminTarget } from "./settings-admin.ts";

const NEW_SITE_PROMPT = "I want a new site. Ask me what it is for or where its code is, then build it and deploy it here with sites_deploy, and give me its address.";
const SCREEN: Readonly<Record<string, string>> = { artifacts: "chats.artifacts", sites: "apps.site-editor", forms: "apps.form-settings", templates: "apps.templates", domains: "apps.sending-domains" };

export { appsRoute } from "../../places/apps/shell/routes.ts";
import { appsRoute } from "../../places/apps/shell/routes.ts";

export function appsData(rt: ShellRuntime, consoleAllowed = false): AppsData {
  const deferred = new Set(rt.deferredModules);
  return {
    assistantId: rt.assistant.id, me: { id: rt.me.id, name: rt.me.name }, connection: rt.connection,
    screens: rt.screens, call: rt.call, clock: () => ({ now: rt.clock().now }), team: rt.space.kind === "team", deferred: [...deferred], ...(rt.baseUrl ? { baseUrl: rt.baseUrl } : {}),
    nameOf: nameOf(rt), ...(rt.putBlob ? { putBlob: (url: string, bytes: Uint8Array) => rt.putBlob!(url, bytes) } : {}),
    renderShare: (resource, onClose) => <FolderShareSheet rt={rt} folderId={resource.id} resource={resource} onClose={onClose} />,
    nav: {
      open: (group, id) => rt.open({ screen: SCREEN[group] ?? "apps.forms", args: { selected: id } }),
      newSite: () => { openAskPane({ thing: null, first: NEW_SITE_PROMPT }, "apps"); },
      ask: (first) => { openAskPane({ thing: null, first }, "apps"); },
      openUrl: (url) => rt.openUrl(url),
      openComputers: () => rt.open({ screen: "settings.page", args: { page: "computers" } }),
      create: (group, kind) => rt.open({ screen: group === "forms" ? "apps.forms" : SCREEN[group] ?? "apps.forms", args: { create: true, ...(kind ? { kind } : {}) } }),
      openArtifact: (artifactId) => rt.open(artifactId ? { subject: { type: "artifact", id: artifactId } } : { screen: "chats.artifacts" }),
      // the sending domains list has no screen of its own any more: the place already shows it
      show: (group) => { if (group === "domains") return; rt.open({ screen: group === "chats" ? "chats.conversation" : group === "artifacts" ? "chats.artifacts" : group === "sites" ? "apps.sites" : group === "forms" ? "apps.forms" : SCREEN[group] ?? "apps.forms" }); },
      openEmailDesign: (emailId) => rt.open({ screen: "apps.email-builder", ...(emailId ? { args: { emailId } } : {}) }),
      ...(consoleAllowed ? { addDomain: () => rt.open(adminTarget("mail.domains", { create: "true" })) } : {}),
      joinTeam: () => rt.open({ screen: "settings.page", args: { page: "spaces" } }),
      openTask: (taskId) => rt.open({ subject: { type: "task", id: taskId } }),
      openThread: (threadId) => rt.open({ subject: { type: "thread", id: threadId } }),
    },
  };
}

export default function AppsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const { target } = usePlaceHash();
  // may this person open the Console? Sending domains are added there, so nobody is sent to a page they cannot open
  const [consoleAllowed, setConsoleAllowed] = useState(false);
  useEffect(() => {
    if (!rt || rt.space.kind === "personal" || rt.plainRole === true) return undefined;
    let live = true;
    void rt.call("console.nav", {}).then((out) => { if (live) setConsoleAllowed(adminPages(out as Parameters<typeof adminPages>[0]).has("domains")); }, () => undefined);
    return () => { live = false; };
  }, [rt]);
  const data = useMemo(() => (rt ? appsData(rt, consoleAllowed) : null), [rt, consoleAllowed]);
  const route = useMemo(() => appsRoute(target), [target]);
  const start = route.kind === "list" ? { ...(route.group ? { group: route.group } : {}) } : { group: route.group, selected: route.kind === "detail" ? route.id : undefined, open: true };
  return data ? <AppsLayout data={data} start={start} route={route} /> : <AppsLoading />;
}
