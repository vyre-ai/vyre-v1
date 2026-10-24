// no-content-in-logs: log attrs carry ids and counts, never content
// (V1-SPEC 4.18, ARCHITECTURE-V1 4.10). Forbidden keys: body, text, subject, value, secret.

import { finding, matchDelim } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { isCode, skipped } from "./paths.ts";

const RULE = "no-content-in-logs";
const KEYS = ["body", "text", "subject", "value", "secret"];

export function appliesNoContentInLogs(file: string): boolean {
  if (skipped(file)) return false;
  return isCode(file);
}

export function checkNoContentInLogs(file: string, source: string): Finding[] {
  const spans: { start: number; end: number }[] = [];
  const call = /(?:^|[^\w.])(?:ctx\.log|logger|logs|log)\b\s*(?:\.\s*[A-Za-z_$][\w$]*)?\s*\(/g;
  for (const hit of source.matchAll(call)) {
    const open = hit.index + hit[0].length - 1;
    spans.push({ start: open, end: matchDelim(source, open, "(", ")") });
  }
  for (const hit of source.matchAll(/\battrs\s*:\s*\{/g)) {
    const open = hit.index + hit[0].lastIndexOf("{");
    spans.push({ start: open, end: matchDelim(source, open, "{", "}") });
  }
  const out: Finding[] = [];
  const seen = new Set<number>();
  for (const span of spans) {
    for (const key of keysIn(source, span.start, span.end)) {
      if (seen.has(key.index)) continue;
      seen.add(key.index);
      out.push(finding(RULE, file, source, key.index, `log attr "${key.name}" is content; logs keep ids and counts only`));
    }
  }
  return out;
}

function keysIn(source: string, start: number, end: number): { name: string; index: number }[] {
  const hits: { name: string; index: number }[] = [];
  let quote = "";
  for (let i = start; i < end; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      quote = c;
      continue;
    }
    if (i > start && /[\w$]/.test(source[i - 1])) continue;
    for (const name of KEYS) {
      if (!source.startsWith(name, i)) continue;
      const after = source[i + name.length] || "";
      if (/[\w$]/.test(after)) continue;
      let j = i + name.length;
      while (j < end && /\s/.test(source[j])) j++;
      if (source[j] === ":") hits.push({ name, index: i });
    }
  }
  return hits;
}
