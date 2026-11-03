// One answer to "can this account run here, and if not why": the composer, an automation's "Runs on", an agent's AI account and the Space AI accounts all read it (engine.accounts.list with a place),
// so an account that is Working in the Vault is pickable everywhere it is allowed, and one that cannot run in a place says why in the same words. It reuses skipReason, the rule the resolver itself applies.
import { skipReason } from "./resolve.ts";
import type { AccountRow, ResolveRequest, SkipWhy, Trigger } from "./types.ts";

/** Where an account is being picked: a chat's composer, an automation step, an agent's own work, or the Space AI accounts list. */
export type Place = "chat" | "automation" | "agent" | "space";

const TRIGGER: Readonly<Record<Place, Trigger>> = { chat: "message", automation: "task", agent: "routine", space: "message" };

/** The words for each refusal, for the person looking at the picker. */
export const WHY: Readonly<Record<SkipWhy, string>> = {
  unknown: "This account is not in your Vault any more.",
  expired: "Sign in to this account again.",
  failed: "This account is not working. Open it in the Vault to test it.",
  policy_company: "This Space only allows company accounts.",
  not_yours: "This account belongs to someone else.",
  space_may_not_use: "Turn on \"Let the Space run work on my subscription\" for this account to use it here.",
  failed_this_turn: "This account failed a moment ago.",
  capped: "This account reached its monthly cap.",
  no_model: "This account does not list the model you picked.",
  not_used_for: "An admin has not kept this account for this kind of work.",
};

/** Usable here, or the reason it is not. `model` narrows to accounts that list it; `me` is the person picking. */
export function usableHere(row: AccountRow, place: Place, o: { me: string; policy: "any" | "company"; onServer: boolean; model?: string; agentId?: string }): { usable: true } | { usable: false; why: string } {
  // a signed-out or failing account says so first, whatever else would also stop it
  if (row.status === "expired") return { usable: false, why: WHY.expired };
  if (row.status === "failed") return { usable: false, why: WHY.failed };
  const req: ResolveRequest = {
    starter: o.me, trigger: TRIGGER[place], agent: { agentId: o.agentId ?? "", accountPolicy: "asker" }, backupRefs: [], policy: o.policy, accounts: [row],
    ...(o.model ? { model: o.model } : {}), onServer: place === "chat" ? o.onServer : true,
  };
  // a Space account is checked against the work of the place; the person's own account is theirs for chats and needs the switch elsewhere
  const why = skipReason(row, req, o.me, { ...(row.mine ? {} : { use: place !== "space" }), ...(o.model ? { space: !row.mine } : {}) });
  return why === null ? { usable: true } : { usable: false, why: WHY[why] };
}
