// Console object identifiers used for audit Activity filters; these are not authorization resources.
export const AUDIT_TARGET_KINDS = ["person", "agent", "actor", "service", "group", "role", "grant", "policy", "review", "device", "session", "invite"] as const;
export interface AuditTarget { kind: typeof AUDIT_TARGET_KINDS[number]; id: string }
