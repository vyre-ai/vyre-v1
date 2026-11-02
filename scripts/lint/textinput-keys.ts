// textinput-keys: a TextInput (or ui/TextField) takes its key handler as onKeyPress. react-native-web replaces a TextInput's onKeyDown with its own handler and calls only
// onKeyPress, so an onKeyDown passed to one (directly or through webOnly/webProps) is dropped without a sound: arrows, Enter and Escape silently do nothing in the app.

import { finding } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { isCode, skipped } from "./paths.ts";

const RULE = "textinput-keys";
const OPEN = /<(TextInput|TextField)\b/g;

export function appliesTextInputKeys(file: string): boolean {
  if (skipped(file)) return false;
  return isCode(file) && /\.tsx$/.test(file);
}

/** The opening tag of each TextInput and TextField, braces balanced, and whether it hands over an onKeyDown. */
export function checkTextInputKeys(file: string, source: string): Finding[] {
  const out: Finding[] = [];
  for (let m = OPEN.exec(source); m; m = OPEN.exec(source)) {
    let depth = 0, i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break;
    }
    const tag = source.slice(m.index, i);
    const at = tag.search(/\bonKeyDown\b/);
    if (at >= 0) out.push(finding(RULE, file, source, m.index + at, `${m[1]} drops onKeyDown on the web; pass the handler as onKeyPress`));
  }
  OPEN.lastIndex = 0;
  return out;
}
