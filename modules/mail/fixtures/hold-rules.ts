// What counts as "held for an agent" in the registry sweeps (tests only). The `when` must be one of the expressions the gate is known to evaluate the right way, matched exactly: a look-alike that merely contains the right words does not count.
export interface GateDef {
  act: string;
  when?: string;
  reason?: string;
}
/** Conditions that hold an agent or automation and let a person's own change through, exactly as written in the manifests. */
export const HOLD_WHENS: ReadonlySet<string> = new Set([
  "actor.kind != 'person'",
  "actor.kind == 'agent'",
  "actor.kind != 'person' and (input.action == 'set' or input.action == 'reset')",
  "mail.smtp_override(input)",
  "mail.is_provider_setting(input.key)",
  "mail.non_sync_actor(input)",
  "vault.key_host_unapproved(input)",
  "members.invite_by_actor(input)",
]);
/** A gate with a known holding condition, or a Gate on every call (any act but "none"). */
export const held = (g: GateDef | undefined): boolean =>
  !!g && (g.when === undefined ? g.act !== "none" : HOLD_WHENS.has(g.when));
