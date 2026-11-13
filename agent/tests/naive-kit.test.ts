// The naive first call (13 Nov 2026): what a capable model writes for a tool from its description and the input list it is shown, with nothing else. Required inputs only, each with a plausible real value (an id
// is written the way a tool returned it, a name is a name). Never a placeholder word the probe guard refuses. Shared by the generator (scripts/naive-calls.ts) and the ratchet (tools.naive.test.ts).
type P = {
  type?: string;
  enum?: unknown[];
  examples?: unknown[];
  items?: P;
  properties?: Record<string, P>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  const?: unknown;
  minItems?: number;
  oneOf?: P[];
  anyOf?: P[];
};

const TEXT: ReadonlyArray<[RegExp, string]> = [
  [/^(?:html)$/, "<h1>Quarterly plan</h1><p>Three priorities for the quarter.</p>"],
  [/^(?:title|name|label|subject|heading|summary)$/, "Quarterly planning"],
  [
    /^(?:text|body|message|content|note|description|reason|prompt|instructions?|question|answer|comment|markdown)$/,
    "Here is the summary you asked for.",
  ],
  [/(?:^|[a-z])(?:url|href|link|uri)$|^(?:url|href|link|uri)$/i, "https://acme.test/plan"],
  [/^(?:path|dir|cwd|file|filename|folder)$/i, "notes/plan.md"],
  [/emails?$|^(?:to|cc|bcc|from|address|account)$/i, "dana@acme.test"],
  [/^(?:q|query|search|term|keyword|pattern)$/i, "quarterly plan"],
  [/^(?:repo)$/i, "acme/site"],
  [/^(?:branch|ref)$/i, "main"],
  [/^(?:command|cmd)$/i, "ls"],
  [/^(?:domain|host|hostname)$/i, "plan.acme.test"],
  [/^(?:key|handle)$/i, "Plan_Key"],
  [/^(?:zone|timezone|tz)$/i, "America/New_York"],
  [/^(?:date|day)$/i, "2026-11-20"],
  [/(?:at|start|end|until|since|from|due)$/i, "2026-11-20T15:00:00Z"],
];

function text(key: string, p: P): string {
  const hit = TEXT.find(([re]) => re.test(key));
  let v = hit ? hit[1] : "Quarterly planning";
  if (p.minLength !== undefined) while (v.length < p.minLength) v += " and more";
  if (p.maxLength !== undefined && v.length > p.maxLength) v = v.slice(0, p.maxLength);
  return v;
}

/** One value for a property, as a model would write it. */
export function naiveValue(key: string, p: P): unknown {
  if (p.const !== undefined) return p.const;
  if (p.enum && p.enum.length > 0) return p.enum[0];
  const alt = p.oneOf?.[0] ?? p.anyOf?.[0];
  if (alt && p.type === undefined) return naiveValue(key, alt);
  const ex = p.examples?.[0];
  if (typeof ex === "string" && p.pattern !== undefined) return ex;
  switch (p.type) {
    case "string":
      return typeof ex === "string" ? ex : text(key, p);
    case "integer":
    case "number": {
      const lo = p.minimum ?? 0;
      const v = Math.max(lo, 1);
      return p.maximum !== undefined ? Math.min(v, p.maximum) : v;
    }
    case "boolean":
      return false;
    case "array": {
      const one = p.items && p.items.type !== undefined ? naiveValue(key, p.items) : undefined;
      if (one === undefined) return [];
      return Array.from({ length: Math.max(1, p.minItems ?? 1) }, () => one);
    }
    case "object":
      return naiveObject(p);
    default:
      return typeof ex === "string" ? ex : text(key, p);
  }
}

/** The required inputs of an object schema, each with a plausible value. */
export function naiveObject(s: P): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of s.required ?? []) out[k] = naiveValue(k, s.properties?.[k] ?? {});
  return out;
}
