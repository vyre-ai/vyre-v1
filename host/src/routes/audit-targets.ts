// Object Activity identifiers for successful administrative calls. Only declared ID fields
// from this allowlist are retained; credentials, labels, policy values and arbitrary payloads never enter audit metadata.
import type { AuditTarget } from "../../../packages/contracts/src/audit-targets.ts";
export type { AuditTarget } from "../../../packages/contracts/src/audit-targets.ts";
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function auditTargets(cap: string, input: unknown, output: unknown): AuditTarget[] | undefined {
  const i = object(input), o = object(output);
  const targets: AuditTarget[] = [];
  const add = (kind: AuditTarget["kind"], value: unknown, prefix: string): void => {
    if (typeof value !== "string" || !new RegExp(`^${prefix}_[a-z0-9]+$`).test(value)) return;
    if (!targets.some((target) => target.kind === kind && target.id === value)) targets.push({ kind, id: value });
  };
  const principal = (value: unknown): void => {
    const ref = object(value);
    const prefixes: Record<string, string> = { person: "usr", agent: "agt", actor: "act", service: "svc", group: "grp", role: "rol" };
    if (typeof ref.kind === "string" && prefixes[ref.kind]) add(ref.kind as AuditTarget["kind"], ref.id, prefixes[ref.kind]!);
  };
  if (cap.startsWith("access.actors.")) {
    add("actor", i.actorId ?? o.actorId ?? object(o.actor).id, "act");
  } else if (cap.startsWith("access.roles.")) {
    add("role", i.roleId ?? object(o.role).id, "rol");
    principal(i.subject);
  } else if (cap.startsWith("access.groups.")) {
    add("group", i.groupId ?? o.groupId ?? object(o.group).id, "grp");
    principal(i.member);
  } else if (cap.startsWith("access.grants.") || cap === "access.share" || cap === "access.unshare") {
    add("grant", i.grantId ?? object(o.grant).id, "gnt");
    principal(object(o.grant).subject);
  } else if (cap.startsWith("access.reviews.")) {
    add("review", i.reviewId ?? object(o.review).id, "rvw");
    add("grant", i.grantId, "gnt");
  } else if (cap === "members.sign_in_policy.set") {
    targets.push({kind:"policy",id:"sign_in"});
  } else if (cap === "access.policies.set") {
    if (typeof i.key === "string" && /^(gate|spend|limit|provider_label|retention|sign_in|sharing|vault)[.][a-z0-9_.:-]{1,120}$/.test(i.key)) targets.push({ kind: "policy", id: i.key });
  } else if (cap.startsWith("members.") || cap === "identity.reset_start") {
    add("person", i.personId ?? o.personId, "usr");
  } else if (cap.startsWith("devices.")) {
    add("device", i.deviceId ?? object(o.device).id, "dev");
    add("session", i.sessionId, "ses");
  }
  return targets.length ? targets : undefined;
}
