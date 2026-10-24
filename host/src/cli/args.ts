// A small argument parser: `--name value`, `--name=value`, `--flag`, `--` (everything after it is the child's), and positionals.
// A flag takes the next word as its value unless it is a known boolean or the next word is another flag.
export interface Parsed { positional: string[]; flags: Map<string, string | true>; rest: string[] }

export function parseArgs(argv: readonly string[], booleans: ReadonlySet<string> = new Set()): Parsed {
  const out: Parsed = { positional: [], flags: new Map(), rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") { out.rest = argv.slice(i + 1); break; }
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      if (eq > 0) { out.flags.set(a.slice(2, eq), a.slice(eq + 1)); continue; }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (booleans.has(name) || next === undefined || next.startsWith("--")) { out.flags.set(name, true); continue; }
      out.flags.set(name, next);
      i++;
      continue;
    }
    out.positional.push(a);
  }
  return out;
}

/** `dry-run` to `dryRun`; a name that is already camelCase is left alone. */
export const camel = (flag: string): string => flag.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
export const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function flagText(p: Parsed, name: string): string | undefined {
  const v = p.flags.get(name);
  return typeof v === "string" ? v : undefined;
}
