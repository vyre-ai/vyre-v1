// Syntax colour for a fenced code block, with no library: a small tokenizer that knows comments, strings, numbers and each language family's keywords. It is not a parser and does not try to be one; its promise is
// that the tokens together are exactly the code, so colour never changes a character, and an unknown language is one plain run.

export type TokenKind = "plain" | "kw" | "str" | "cm" | "num" | "fn" | "ty" | "op";
export interface Token { k: TokenKind; v: string }

const JS = "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of void yield static this super null undefined true false interface type enum implements readonly public private protected as satisfies";
const PY = "def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield None True False async await global nonlocal self";
const SH = "if then else elif fi for while do done case esac function in echo export cd ls cat grep sed awk npm npx node git docker curl sudo set unset source";
const SQL = "select from where join left right inner outer on group by order having insert into values update set delete create table alter drop index primary key foreign references not null and or as limit offset union distinct count sum avg min max case when then else end";
const GO = "func package import return if else for range switch case break continue go defer chan map struct interface type var const nil true false select";
const RS = "fn let mut pub struct enum impl trait use mod match if else for while loop return self Self crate where as in ref move async await true false None Some Ok Err";

const LANGS: Record<string, { kw: Set<string>; line: string[]; block?: [string, string]; strs: string[]; ci?: boolean }> = {};
const def = (names: string[], kw: string, line: string[], block: [string, string] | undefined, strs: string[], ci = false): void => {
  for (const n of names) LANGS[n] = { kw: new Set(kw.split(" ")), line, ...(block ? { block } : {}), strs, ...(ci ? { ci } : {}) };
};
def(["js", "jsx", "javascript", "ts", "tsx", "typescript", "mjs", "cjs"], JS, ["//"], ["/*", "*/"], ['"', "'", "`"]);
def(["json", "jsonc"], "true false null", [], undefined, ['"']);
def(["py", "python"], PY, ["#"], undefined, ['"""', "'''", '"', "'"]);
def(["sh", "bash", "shell", "zsh", "console"], SH, ["#"], undefined, ['"', "'"]);
def(["sql"], SQL, ["--"], ["/*", "*/"], ["'", '"'], true);
def(["go", "golang"], GO, ["//"], ["/*", "*/"], ['"', "`", "'"]);
def(["rs", "rust"], RS, ["//"], ["/*", "*/"], ['"']);
def(["yaml", "yml", "toml", "ini"], "true false null yes no on off", ["#"], undefined, ['"', "'"]);
def(["css", "scss"], "important from to and or not", [], ["/*", "*/"], ['"', "'"]);
def(["html", "xml", "svg"], "", [], ["<!--", "-->"], ['"', "'"]);
def(["md", "markdown"], "", [], undefined, []);

const WORD = /[A-Za-z_$][\w$]*/y;
const NUM = /(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)/y;

/** The code as tokens; joined, they are the code. */
export function highlight(lang: string, code: string): Token[] {
  const L = LANGS[lang.toLowerCase()];
  if (!L || code.length > 20_000) return [{ k: "plain", v: code }];
  const out: Token[] = [];
  let plain = "";
  const flush = (): void => { if (plain !== "") { out.push({ k: "plain", v: plain }); plain = ""; } };
  const push = (k: TokenKind, v: string): void => { flush(); out.push({ k, v }); };
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    // comments
    const lc = L.line.find((m) => rest.startsWith(m));
    if (lc) { const end = code.indexOf("\n", i); const e = end < 0 ? code.length : end; push("cm", code.slice(i, e)); i = e; continue; }
    if (L.block && rest.startsWith(L.block[0])) { const end = code.indexOf(L.block[1], i + L.block[0].length); const e = end < 0 ? code.length : end + L.block[1].length; push("cm", code.slice(i, e)); i = e; continue; }
    // strings
    const q = L.strs.find((m) => rest.startsWith(m));
    if (q) {
      let j = i + q.length;
      while (j < code.length && !code.startsWith(q, j)) { if (code[j] === "\\") j++; if (q.length === 1 && code[j] === "\n") break; j++; }
      const e = Math.min(code.length, code.startsWith(q, j) ? j + q.length : j);
      push("str", code.slice(i, e));
      i = e;
      continue;
    }
    NUM.lastIndex = i;
    if (/\d/.test(code[i] ?? "") && !/[\w$]/.test(code[i - 1] ?? "")) { const m = NUM.exec(code); if (m) { push("num", m[0]); i += m[0].length; continue; } }
    WORD.lastIndex = i;
    const w = WORD.exec(code);
    if (w) {
      const word = w[0];
      const isKw = L.kw.has(L.ci ? word.toLowerCase() : word);
      if (isKw) push("kw", word);
      else if (code[i + word.length] === "(") push("fn", word);
      else if (/^[A-Z]/.test(word) && L.kw.size > 0) push("ty", word);
      else plain += word;
      i += word.length;
      continue;
    }
    plain += code[i];
    i++;
  }
  flush();
  return out;
}
