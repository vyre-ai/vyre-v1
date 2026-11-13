// What a model is shown of its tools, and what it costs (13 Nov 2026, owner: "faster, consumes less tokens"). For each engine kind: the number of tools, the total size of what is shown (name, description and input
// schema, in characters and an estimated tokens at 4 characters each) and the ten largest. "before" is the generated list as the tool layer used to show it (every input, the idempotency key, the examples);
// "now" is what the tool layer shows today. The API driver also slims the schema (examples, patterns dropped); the MCP bridge shows the schema as the catalog holds it.
//   node scripts/tool-tokens.ts [--write]     --write records scripts/tool-tokens-baseline.json, which tool-tokens.test.ts holds the sizes under
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadGenerated } from "../agent/src/tools/harness.ts";
import { slimTool } from "../agent/src/drivers/api/slim.ts";
import { rejectWords } from "../agent/src/tools/reject.ts";

const root = (f: string): string => fileURLToPath(new URL(`../${f}`, import.meta.url));
export interface Sizes {
  tools: number;
  chars: number;
  tokens: number;
  largest: Array<{ name: string; chars: number }>;
}
const size = (rows: Array<{ name: string; description: string; inputSchema: unknown }>): Sizes => {
  const per = rows.map((r) => ({
    name: r.name,
    chars: r.name.length + r.description.length + JSON.stringify(r.inputSchema ?? null).length,
  }));
  const chars = per.reduce((n, r) => n + r.chars, 0);
  return {
    tools: rows.length,
    chars,
    tokens: Math.round(chars / 4),
    largest: per.sort((a, b) => b.chars - a.chars).slice(0, 10),
  };
};

export function measure() {
  const { catalog, defaults } = loadGenerated();
  const raw = (
    JSON.parse(readFileSync(root("generated/mcp-tools.json"), "utf8")) as {
      tools: Array<{ name: string; description: string; inputSchema: unknown }>;
    }
  ).tools;
  const shown = catalog.all.map((t) => ({ name: t.name, description: t.summary, inputSchema: t.inputSchema }));
  const slim = shown.map((t) => slimTool(t as never) as { name: string; description: string; inputSchema: unknown });
  const rawSlim = raw.map((t) => slimTool(t as never) as { name: string; description: string; inputSchema: unknown });
  const dflt = (rows: typeof shown): typeof shown => rows.filter((r) => defaults.has(r.name));
  const art = catalog.byName("artifact_publish")!;
  return {
    all: {
      before_mcp_bridge: size(raw),
      now_mcp_bridge: size(shown),
      before_api_slim: size(rawSlim),
      now_api_slim: size(slim),
    },
    default_toolset: {
      before_api_slim: size(dflt(rawSlim)),
      now_api_slim: size(dflt(slim)),
      before_mcp_bridge: size(dflt(raw)),
      now_mcp_bridge: size(dflt(shown)),
    },
    rejection_chars: {
      before: JSON.stringify({
        error: {
          code: "validation.bad_input",
          message: "Something in what you entered is not right.",
          next: [{ label: "Fix the input" }],
        },
      }).length,
      now: rejectWords(art, ["/title: required"], 'artifact_publish {"title":"Q3 plan","html":"<h1>Q3</h1>"}').length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = measure();
  for (const [group, v] of Object.entries(m)) {
    console.log(`\n${group}`);
    if (group !== "rejection_chars")
      for (const [k, s] of Object.entries(v as Record<string, Sizes>))
        console.log(`  ${k}: ${s.tools} tools, ${s.chars} chars, about ${s.tokens} tokens`);
    else console.log(`  ${JSON.stringify(v)}`);
  }
  console.log(
    "\nten largest now (api slim):",
    m.all.now_api_slim.largest.map((x) => `${x.name} ${x.chars}`).join(", "),
  );
  if (process.argv.includes("--write"))
    writeFileSync(
      root("scripts/tool-tokens-baseline.json"),
      `${JSON.stringify({ api_slim_chars: m.all.now_api_slim.chars, mcp_bridge_chars: m.all.now_mcp_bridge.chars, default_api_slim_chars: m.default_toolset.now_api_slim.chars }, null, 2)}\n`,
    );
}
