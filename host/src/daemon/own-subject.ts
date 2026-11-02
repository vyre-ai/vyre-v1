// The owner check behind the Personal gate's one exception (host/src/invoke.ts OWN_SHARE_CAPS): a person may share their own item with their own agent or automation in a Personal Space.
/**
 * Whether an agent or automation belongs to this person, from the modules' own rows (agents_agent.ownerId, automations_defs.owner_id), never from the call: the Personal gate lets a person
 * share their own item with their own agent or automation (host/src/invoke.ts OWN_SHARE_CAPS). Anything unknown, removed or someone else's is not theirs.
 */
export function ownsSubject(db: { all(sql: string, ...args: unknown[]): unknown[] }, subject: { kind: string; id: string }, person: string): boolean {
  try {
    if (subject.kind === "agent") {
      const r = db.all(`SELECT "ownerId" FROM agents_agent WHERE "id" = ? AND "deletedAt" IS NULL`, subject.id)[0] as { ownerId?: string } | undefined;
      return r?.ownerId === person;
    }
    if (subject.kind === "service" && subject.id.startsWith("svc_") && subject.id.length > 4) {
      const r = db.all(`SELECT "owner_id" FROM automations_defs WHERE "id" = ? AND "deleted_at" IS NULL`, `aut_${subject.id.slice(4)}`)[0] as { owner_id?: string } | undefined;
      return r?.owner_id === person;
    }
  } catch { /* no such table yet: nothing is theirs */ }
  return false;
}
