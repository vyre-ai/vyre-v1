// One handler per gate capability (10). Parking, rules and reads live in hold.ts; release, deny, expire and the sweep in approve.ts.
import { deny, expire, release } from "./approve.ts";
import { holdsRevise } from "./revise.ts";
import { allowList, allowRemove, allowSet, grantsAsk, grantsGiveBack, grantsGoal, grantsSet, grantsTake, linksKnown, taintMark } from "./grants.ts";
import { actsList, effectiveRuleOf, holdsGet, holdsList, park, resultTake, rulesList, rulesSet } from "./hold.ts";

export const handlers = {
  "gate.acts.list": actsList,
  "gate.allow.list": allowList,
  "gate.allow.remove": allowRemove,
  "gate.allow.set": allowSet,
  "gate.deny": deny,
  "gate.effective_rule": effectiveRuleOf,
  "gate.expire": expire,
  "gate.grants.ask": grantsAsk,
  "gate.grants.set": grantsSet,
  "gate.grants.take": grantsTake,
  "gate.grants.goal": grantsGoal,
  "gate.grants.give_back": grantsGiveBack,
  "gate.holds.get": holdsGet,
  "gate.links.known": linksKnown,
  "gate.taint.mark": taintMark,
  "gate.holds.list": holdsList,
  "gate.holds.revise": holdsRevise,
  "gate.park": park,
  "gate.result.take": resultTake,
  "gate.release": release,
  "gate.rules.list": rulesList,
  "gate.rules.set": rulesSet,
};
