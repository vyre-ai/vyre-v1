import type { GroupKey } from "./model.ts";
import type { AppsRoute as PlaceRoute } from "./AppsPlace.tsx";
export interface AppsRoute { group: GroupKey; id?: string; create?: boolean }
interface HashTarget { screen?: string; subject?: { type: string; id: string }; args: Record<string, string> }
const screens: Record<string, Exclude<GroupKey, "sites">> = { "apps.forms": "forms", "apps.form-settings": "forms", "apps.campaigns": "campaigns", "apps.campaign-builder": "campaigns", "apps.templates": "templates", "apps.sending-domains": "domains", "mail.domains": "domains" };
export function appsRoute(target: HashTarget): PlaceRoute {
  // one email design on its own (the builder Campaigns embeds in a step): with an id it opens that design, without one it starts a new one
  if (target.screen === "apps.email-builder") { const emailId = target.args.emailId ?? target.args.selected; return { kind: "email", group: "campaigns", ...(emailId ? { id: emailId } : {}) }; }
  const group = screens[target.screen ?? ""];
  if (!group) return { kind: "list" };
  const expected = { forms: "form", campaigns: "campaign", templates: "template", domains: "domain" }[group];
  const id = target.args.selected ?? target.args[`${expected}Id`] ?? (target.subject?.type === expected ? target.subject.id : undefined);
  if (target.args.create === "true") return { kind: "create", group };
  return id ? { kind: "detail", group, id } : { kind: "list", group };
}
