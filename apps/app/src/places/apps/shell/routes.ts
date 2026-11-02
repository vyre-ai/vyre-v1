import type { GroupKey } from "./model.ts";
import type { AppsRoute as PlaceRoute } from "./AppsPlace.tsx";
export interface AppsRoute { group: GroupKey; id?: string; create?: boolean }
interface HashTarget { screen?: string; subject?: { type: string; id: string }; args: Record<string, string> }
const screens: Record<string, GroupKey> = { "apps.sites": "sites", "apps.site-editor": "sites", "apps.forms": "forms", "apps.form-settings": "forms", "apps.templates": "templates", "apps.sending-domains": "domains", "mail.domains": "domains" };
export function appsRoute(target: HashTarget): PlaceRoute {
  // one email design on its own (the builder Inbox templates and Automation email steps share): with an id it opens that design, without one it starts a new one
  if (target.screen === "apps.email-builder") { const emailId = target.args.emailId ?? target.args.selected; return { kind: "email", group: "templates", ...(emailId ? { id: emailId } : {}) }; }
  if (target.screen === "apps.artifacts") { const id = target.args.selected ?? target.args.artifactId; return { kind: "artifacts", group: "sites", ...(id ? { id } : {}) }; }
  const group = screens[target.screen ?? ""];
  if (!group) return { kind: "list" };
  const expected = { sites: "site", forms: "form", templates: "template", domains: "domain" }[group];
  const id = target.args.selected ?? target.args[`${expected}Id`] ?? (target.subject?.type === expected ? target.subject.id : undefined);
  if (target.args.create === "true" && group !== "sites") return { kind: "create", group };
  return id ? { kind: "detail", group, id } : { kind: "list", group };
}
