// no-color-mix: react-native-web drops a color-mix() value in a style object (the marble faces and the call pill went blank, twice).
// A fill is a one-colour gradient layer in backgroundImage, or a plain rgba / token. color-mix() stays only where the string
// really goes to the DOM or a stylesheet (a createElement style, a CSS rule, a custom property), and says so with
// `// color-mix-ok: <reason>` on the same line or the line before. A gradient( on the same line is fine: that is the layer fix.

import { finding } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { isCode, skipped } from "./paths.ts";

const RULE = "no-color-mix";
const MIX = /color-mix\(/g;
const OK = /color-mix-ok:\s*\S/;

export function appliesNoColorMix(file: string): boolean {
  if (skipped(file)) return false;
  if (!isCode(file)) return false;
  return /^(?:apps\/app\/src|ui\/src|scripts\/shots\/mounts)\//.test(file);
}

export function checkNoColorMix(file: string, source: string): Finding[] {
  const raw = source.split("\n");
  const code = stripComments(source).split("\n");
  const out: Finding[] = [];
  let offset = 0;
  for (let i = 0; i < code.length; i++) {
    const line = code[i];
    const lineStart = offset;
    offset += raw[i].length + 1;
    MIX.lastIndex = 0;
    const hit = MIX.exec(line);
    if (!hit) continue;
    if (OK.test(raw[i]) || (i > 0 && OK.test(raw[i - 1]))) continue;
    if (/gradient\(/.test(line)) continue;
    out.push(finding(RULE, file, source, lineStart + hit.index, "react-native-web drops color-mix() in a style object; use a one-colour gradient in backgroundImage, an rgba, or a token, or add `// color-mix-ok: <reason>` where the string goes to the DOM or a stylesheet"));
  }
  return out;
}

/** Comments become spaces (line numbers and columns stay), so a mention of color-mix() in prose is not a finding. */
function stripComments(source: string): string {
  const block = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return block.replace(/(^|[^:])\/\/[^\n]*/g, (comment, lead) => lead + " ".repeat(comment.length - lead.length));
}
