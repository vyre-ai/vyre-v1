// One handler per gate capability (10). Parking, rules and reads live in hold.ts; release, deny, expire and the sweep in approve.ts.
import { deny, expire, release } from "./approve.ts";
import { actsList, effectiveRuleOf, holdsGet, holdsList, park, rulesList, rulesSet } from "./hold.ts";

export const handlers = {
  "gate.acts.list": actsList,
  "gate.deny": deny,
  "gate.effective_rule": effectiveRuleOf,
  "gate.expire": expire,
  "gate.holds.get": holdsGet,
  "gate.holds.list": holdsList,
  "gate.park": park,
  "gate.release": release,
  "gate.rules.list": rulesList,
  "gate.rules.set": rulesSet,
};
