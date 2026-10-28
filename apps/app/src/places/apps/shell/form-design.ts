export interface PreviewField { key: string; title: string; type: string; required?: boolean; options?: Record<string, unknown> }
export interface Choice { key: string; title: string }
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function choicesOf(field: PreviewField): Choice[] {
  const raw = field.options?.[field.type === "status" ? "stages" : "choices"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => typeof v === "string" ? [{key:v,title:v}] : isObject(v) && typeof v.key === "string" ? [{key:v.key,title:typeof v.title === "string" ? v.title : v.key}] : []);
}
export interface FormRule { when: unknown; show?: string[]; hide?: string[]; require?: string[]; [key: string]: unknown }
const names = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
export const rulesOf = (logic: unknown): FormRule[] => isObject(logic) && Array.isArray(logic.rules) ? logic.rules.filter(isObject).map((v) => ({...v,when:v.when})) : [];
const text = (v: unknown): string => Array.isArray(v) ? v.join(",") : v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
const empty = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || Array.isArray(v) && v.length === 0;
function holds(condition: unknown, answers: Record<string, unknown>): boolean {
  if (!isObject(condition)) return false;
  if (Array.isArray(condition.all)) return condition.all.every((c) => holds(c, answers));
  if (Array.isArray(condition.any)) return condition.any.some((c) => holds(c, answers));
  if ("not" in condition) return !holds(condition.not, answers);
  const have = answers[String(condition.field)], want = condition.value;
  switch (condition.op) {
    case "empty": return empty(have); case "not_empty": return !empty(have);
    case "eq": return Array.isArray(have) ? have.includes(text(want)) : text(have) === text(want);
    case "ne": return Array.isArray(have) ? !have.includes(text(want)) : text(have) !== text(want);
    case "in": return Array.isArray(want) && want.map(text).includes(text(have));
    case "contains": return text(have).toLowerCase().includes(text(want).toLowerCase());
    case "gt": case "gte": case "lt": case "lte": {
      const a=Number(have),b=Number(want); if(empty(have)||!Number.isFinite(a)||!Number.isFinite(b)) return false;
      return condition.op === "gt" ? a>b : condition.op === "gte" ? a>=b : condition.op === "lt" ? a<b : a<=b;
    }
    default: return false;
  }
}
/** Mirrors the public submit evaluator: hidden answers do not feed other rules. */
export function previewLogic(logic: unknown, answers: Record<string, unknown>): { hidden: Set<string>; required: Set<string> } {
  const rules=rulesOf(logic), starts=rules.flatMap((r)=>names(r.show)); let hidden=new Set(starts),required=new Set<string>();
  for(let pass=0;pass<8;pass++) {
    const seen=Object.fromEntries(Object.entries(answers).filter(([k])=>!hidden.has(k))),next=new Set(starts),need=new Set<string>();
    for(const rule of rules) if(holds(rule.when,seen)) for(const f of names(rule.show)) next.delete(f);
    for(const rule of rules) if(holds(rule.when,seen)) { for(const f of names(rule.hide)) next.add(f); for(const f of names(rule.require)) need.add(f); }
    const same=next.size===hidden.size&&[...next].every((f)=>hidden.has(f)); hidden=next;required=need;if(same)break;
  }
  for(const f of hidden)required.delete(f); return {hidden,required};
}
export function updateRules(logic: unknown, rules: FormRule[]): Record<string, unknown> { return {...(isObject(logic)?logic:{}), rules}; }
