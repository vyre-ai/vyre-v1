// no-em-dash-or-section-sign: no em dash and no section sign in code, copy or docs
// (ARCHITECTURE-V1 conventions, V1-SPEC design bar).

import { finding } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { skipped } from "./paths.ts";

const RULE = "no-em-dash-or-section-sign";

export function appliesNoEmDashOrSectionSign(file: string): boolean {
  if (skipped(file)) return false;
  return /\.(?:tsx?|jsx|mjs|cjs|js|md|json|html|css|yml|yaml|txt)$/.test(file);
}

type Hit = { re: RegExp; message: string };

function patterns(): Hit[] {
  return [
    { re: new RegExp("\\u2014", "g"), message: "em dash is not allowed" },
    { re: new RegExp("\\u00A7", "g"), message: "section sign is not allowed" },
    { re: new RegExp("\\\\u2014", "g"), message: "em dash is not allowed" },
    { re: new RegExp("\\\\u00[aA]7", "g"), message: "section sign is not allowed" },
    { re: /&mdash;|&#8212;|&#x2014;/gi, message: "em dash is not allowed" },
    { re: /&sect;|&#167;|&#x0*a7;/gi, message: "section sign is not allowed" },
  ];
}

export function checkNoEmDashOrSectionSign(file: string, source: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<number>();
  for (const pattern of patterns()) {
    for (const hit of source.matchAll(pattern.re)) {
      if (hit.index === undefined || seen.has(hit.index)) continue;
      seen.add(hit.index);
      out.push(finding(RULE, file, source, hit.index, pattern.message));
    }
  }
  return out;
}
