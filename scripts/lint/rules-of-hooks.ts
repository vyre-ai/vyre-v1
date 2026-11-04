// rules-of-hooks (enforced): React's rules of hooks over apps/ and ui/, on the TypeScript syntax tree. A hook must run on every render, in the same order:
//   - not after an early return (React error 310 once the early return stops firing: Conversation.tsx and GithubApp.tsx did this on 3464fa6b6)
//   - not inside an if, a ?: branch, the right side of && || ??, a loop, a switch case or an optional call
//   - only in a component (PascalCase, or the function given to memo/forwardRef) or a custom hook (useX), never in a callback, a plain function, an async function or at module level
// The repo has no eslint, so this follows eslint-plugin-react-hooks' rules-of-hooks rule by hand. Bare `use(...)` (React 19) may be conditional, so it is not counted.
// There is no allow comment. Test files are not scanned (renderHook(() => useX()) is a callback by design).
// Before it scans, it checks itself against the fixtures below and fails if it misses one, so a broken check can never read as clean.
//   node scripts/lint/rules-of-hooks.ts [--report] [files...]     exit 1 on a finding (--report prints and exits 0)
// TypeScript comes from tools/gen/node_modules (cd tools/gen && npm install --no-package-lock), as the contracts gate uses it.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export type HookFinding = { file: string; line: number; hook: string; why: string };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK = /^use[A-Z0-9]/;
const COMPONENT = /^[A-Z]/;
const WRAPPERS = new Set(["memo", "forwardRef"]);

export function loadTs(): any {
  const req = createRequire(path.join(REPO, "tools/gen/package.json"));
  try { return req("typescript"); } catch { return null; }
}

function isFn(ts: any, n: any): boolean {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}

/** The hook name of a call, or null: useX(...) or Pascal.useX(...) (React.useState). */
function hookName(ts: any, call: any): string | null {
  const c = call.expression;
  if (ts.isIdentifier(c)) return HOOK.test(c.text) ? c.text : null;
  if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.name) && HOOK.test(c.name.text) && ts.isIdentifier(c.expression) && COMPONENT.test(c.expression.text)) return `${c.expression.text}.${c.name.text}`;
  return null;
}

function calleeName(ts: any, e: any): string | null {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** The name a function goes by: its own, the variable or property it is assigned to, or "memo"/"forwardRef" when it is the function given to one. */
function fnName(ts: any, fn: any): string | null {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  let p = fn.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p))) p = p.parent;
  if (!p) return null;
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) { const l = p.left; if (ts.isIdentifier(l)) return l.text; if (ts.isPropertyAccessExpression(l)) return l.name.text; }
  if (ts.isCallExpression(p) && p.arguments.includes(fn)) { const c = calleeName(ts, p.expression); if (c && WRAPPERS.has(c)) return "memo"; }
  if (ts.isExportAssignment(p)) return "default";
  return null;
}

function owns(name: string | null): boolean {
  return name !== null && (COMPONENT.test(name) || HOOK.test(name) || name === "memo" || name === "default");
}

/** Why the hook does not always run, walking from the call up to its function; null when it always runs. */
function conditional(ts: any, call: any, fn: any): string | null {
  let child = call, p = call.parent;
  const K = ts.SyntaxKind;
  while (p && p !== fn) {
    if (ts.isIfStatement(p) && child !== p.expression) return "inside an if";
    if (ts.isConditionalExpression(p) && child !== p.condition) return "inside a ?: branch";
    if (ts.isBinaryExpression(p) && child === p.right && [K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken, K.AmpersandAmpersandEqualsToken, K.BarBarEqualsToken, K.QuestionQuestionEqualsToken].includes(p.operatorToken.kind)) return "on the right of && || ??";
    if ((ts.isForStatement(p) && child !== p.initializer) || ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && child !== p.expression) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return "inside a loop";
    if (ts.isCaseClause(p) || ts.isDefaultClause(p)) return "inside a switch case";
    if (ts.isCallExpression(p) && p.arguments.includes(child) && (p.questionDotToken || (p.expression && p.expression.questionDotToken))) return "inside an optional call";
    child = p; p = p.parent;
  }
  return null;
}

export function checkHooks(ts: any, file: string, source: string): HookFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: HookFinding[] = [];
  const returns = new Map<any, [number, number][]>();   // function -> [start, end] of its own return statements
  const line = (n: any) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const enclosing = (n: any) => { let p = n.parent; while (p && !isFn(ts, p)) p = p.parent; return p ?? null; };
  const calls: any[] = [];
  const visit = (n: any) => {
    if (ts.isReturnStatement(n)) { const f = enclosing(n); if (f) { const a = returns.get(f) ?? []; a.push([n.getStart(sf), n.getEnd()]); returns.set(f, a); } }
    if (ts.isCallExpression(n) && hookName(ts, n)) calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const call of calls) {
    const hook = hookName(ts, call)!;
    const fn = enclosing(call);
    const at = { file, line: line(call), hook };
    if (!fn) { out.push({ ...at, why: "called at module level" }); continue; }
    const name = fnName(ts, fn);
    if (!owns(name)) { out.push({ ...at, why: name ? `called in "${name}", which is neither a component nor a hook` : "called inside a callback" }); continue; }
    if (fn.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.AsyncKeyword)) { out.push({ ...at, why: "called in an async function" }); continue; }
    const why = conditional(ts, call, fn);
    if (why) { out.push({ ...at, why: `called conditionally (${why})` }); continue; }
    const pos = call.getStart(sf);
    const early = (returns.get(fn) ?? []).find(([, end]) => end <= pos);   // a return that holds the call (return useX()) is not before it
    if (early !== undefined) out.push({ ...at, why: `called after an early return (line ${sf.getLineAndCharacterOfPosition(early[0]).line + 1})` });
  }
  return out;
}

/** Each fixture names the lines that must be found; the check fails before scanning when one is missed or a clean line is flagged. */
export const FIXTURES: { name: string; src: string; lines: number[] }[] = [
  { name: "hook after an early return", src: "function A() {\n  const a = useX();\n  if (!a) return <L />;\n  const b = useY();\n  return <b />;\n}\n", lines: [4] },
  { name: "hook after return null", src: "function A({ d }) {\n  if (!d) return null;\n  const [s] = useState(d.open);\n  return <V />;\n}\n", lines: [3] },
  { name: "useEffect after the returns, in an arrow component", src: "export const A = () => {\n  const q = useQ();\n  if (q.loading) {\n    return <L />;\n  }\n  useEffect(() => {});\n  return <V />;\n};\n", lines: [6] },
  { name: "hooks in branches and loops", src: "function A({ x, xs }) {\n  if (x) useA();\n  const b = x ? useB() : 0;\n  const c = x && useC();\n  for (const y of xs) useD(y);\n  return null;\n}\n", lines: [2, 3, 4, 5] },
  { name: "hook in a callback and a plain function", src: "function A() {\n  const f = () => useA();\n  return null;\n}\nfunction helper() {\n  return useB();\n}\n", lines: [2, 6] },
  { name: "clean: hooks first, returns after, nested callbacks with returns, memo and custom hooks", src: "function A({ d }) {\n  const a = useA();\n  const cb = useCallback(() => { if (d) return 1; return 2; }, [d]);\n  if (!a) return null;\n  return <V />;\n}\nconst B = memo((p) => {\n  const s = useS();\n  return <V />;\n});\nfunction useThing() {\n  const v = React.useState(0);\n  return v;\n}\nfunction useOther() {\n  return useSyncExternalStore(sub, get);\n}\nfunction C() {\n  const r = use(ctx);\n  if (r) { const z = use(other); }\n  return null;\n}\n", lines: [] },
];

export function selfCheck(ts: any): string[] {
  const bad: string[] = [];
  for (const f of FIXTURES) {
    const got = checkHooks(ts, "fixture.tsx", f.src).map((x) => x.line);
    if (JSON.stringify(got) !== JSON.stringify(f.lines)) bad.push(`${f.name}: expected lines ${JSON.stringify(f.lines)}, found ${JSON.stringify(got)}`);
  }
  return bad;
}

export function sourceFiles(root: string): string[] {
  const r = spawnSync("git", ["ls-files", "apps", "ui"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split("\n").filter((f) => /\.[jt]sx?$/.test(f) && !/\.d\.ts$/.test(f) && !/\.test\.[jt]sx?$/.test(f) && !/(^|\/)(node_modules|dist|public)\//.test(f));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const ts = loadTs();
  if (!ts) { console.log("rules-of-hooks: typescript is not installed under tools/gen (cd tools/gen && npm install --no-package-lock); the check cannot run, and a check that cannot run fails"); process.exit(1); }
  const self = selfCheck(ts);
  if (self.length) { for (const s of self) console.log(`rules-of-hooks self-check: ${s}`); process.exit(1); }
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const files = args.length ? args : sourceFiles(REPO);
  const out: HookFinding[] = [];
  for (const f of files) out.push(...checkHooks(ts, f, fs.readFileSync(path.join(REPO, f), "utf8")));
  for (const f of out) console.log(`rules-of-hooks ${f.file}:${f.line}: ${f.hook} ${f.why}`);
  console.log(`rules-of-hooks: ${files.length} files, ${out.length} finding(s), self-check ${FIXTURES.length} fixtures ok`);
  if (out.length && !process.argv.includes("--report")) process.exit(1);
}
