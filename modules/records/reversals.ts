/** A person bringing back, or putting back an earlier version of, what an agent deleted or changed teaches that agent (lib/reversal.ts, memory.corrections.record). */
const AGENT_ACT = ["record.created", "record.updated", "record.deleted", "record.restored"] as const;
const recordOf = (i: { recordId: string }): { type: string; id: string } => ({ type: "record", id: i.recordId });
export const REVERSALS = {
  "records.restore": {
    subject: recordOf, types: ["record.deleted"],
    was: (i: { type?: string }) => `deleted ${i.type ? `a ${i.type} record` : "a record"}`,
  },
  "records.restore_version": {
    subject: recordOf, types: AGENT_ACT,
    was: (i: { type?: string }, _o: unknown, a: { event?: { type: string; payload: Record<string, unknown> } }) => {
      const fields = Object.keys((a.event?.payload["fields"] as Record<string, unknown> | undefined) ?? {}).slice(0, 4);
      return `${a.event?.type === "record.deleted" ? "deleted" : "changed"} ${i.type ? `a ${i.type} record` : "a record"}${fields.length ? ` (${fields.join(", ")})` : ""}`;
    },
  },
};
