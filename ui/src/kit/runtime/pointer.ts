// Pointers and the small expression language a Kit layout uses (ARCH 3.5 LayoutNode).
// A pointer is a JSON pointer into the scope: /queries/<name>, /state/<key>, /row. Inside a list row, /row is the item.
// Expressions (`when.expr`, menu and key `when`): `ptr`, `!ptr`, `empty(ptr)`, `ptr == literal`, `ptr != literal`,
// joined with && and ||. A literal is a number, true, false, null, or a quoted string. Nothing else is evaluated.

export interface Scope {
  queries: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  row?: unknown;
  index?: number;
}

function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** The value at a pointer, or undefined when any step is missing. A pointer that does not start with "/" is undefined. */
export function resolvePointer(scope: Scope, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  const [head, ...rest] = pointer.slice(1).split("/").map(unescapeToken);
  let cur: unknown;
  if (head === "queries") cur = scope.queries;
  else if (head === "state") cur = scope.state;
  else if (head === "row") cur = scope.row;
  else if (head === "index") cur = scope.index;
  else return undefined;
  for (const step of rest) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(step)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[step];
    else return undefined;
  }
  return cur;
}

/** Resolves an input map (`{ id: "/row/id" }`) to values. A missing value is left out, never sent as undefined. */
export function resolveInputMap(map: Readonly<Record<string, string>>, scope: Scope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, pointer] of Object.entries(map)) {
    const value = resolvePointer(scope, pointer);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Text with `{/pointer}` segments filled in. A missing value becomes an empty string. */
export function interpolate(template: string, scope: Scope): string {
  return template.replace(/\{(\/[^}]*)\}/g, (_all, pointer: string) => {
    const value = resolvePointer(scope, pointer);
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? "" : String(value);
  });
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function parseLiteral(text: string): unknown {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const quoted = /^(['"])(.*)\1$/.exec(t);
  return quoted ? quoted[2] : t;
}

function evalTerm(term: string, scope: Scope): boolean {
  const t = term.trim();
  if (t.startsWith("!")) return !evalTerm(t.slice(1), scope);
  const emptyCall = /^empty\(\s*(\/[^)\s]*)\s*\)$/.exec(t);
  if (emptyCall) return isEmptyValue(resolvePointer(scope, emptyCall[1]!));
  const cmp = /^(\/\S*)\s*(==|!=)\s*(.+)$/.exec(t);
  if (cmp) {
    const left = resolvePointer(scope, cmp[1]!);
    const same = left === parseLiteral(cmp[3]!) || (left !== undefined && left !== null && String(left) === String(parseLiteral(cmp[3]!)));
    return cmp[2] === "==" ? same : !same;
  }
  if (t.startsWith("/")) return truthy(resolvePointer(scope, t));
  return false;
}

/** Evaluates an expression. An empty or undefined expression is true. An expression it cannot read is false. */
export function evalExpr(expr: string | undefined, scope: Scope): boolean {
  if (expr === undefined || expr.trim() === "") return true;
  return expr.split("||").some((or) => or.split("&&").every((and) => evalTerm(and, scope)));
}
