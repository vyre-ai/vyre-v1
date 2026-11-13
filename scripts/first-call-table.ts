// The class table of the first-call report (13 Nov 2026): for every tool the catalog holds, its required inputs as a model is shown them, what the tool layer fills in, the inputs a model cannot know, and whether the tool's
// naive first call (agent/tests/golden/naive-calls.json) is accepted by validation before the tool layer fills anything and after.
//   node scripts/first-call-table.ts > table.md
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadGenerated } from "../agent/src/tools/harness.ts";
import { fillInput } from "../agent/src/tools/fill.ts";
import { validateInput } from "../generated/validators.ts";

type P = {
  type?: string;
  enum?: unknown[];
  pattern?: string;
  maxLength?: number;
  maximum?: number;
  examples?: unknown[];
};
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../agent/tests/golden/naive-calls.json", import.meta.url)), "utf8"),
) as Record<string, Record<string, unknown>>;
const { catalog } = loadGenerated();
const ctx = {
  space: "spc_1",
  agentId: "agt_a",
  asker: "usr_a",
  thread: { threadId: "thr_current1", kind: "chat" as const, planMode: false },
  turnId: "trn_1",
};
let before = 0;
let after = 0;
const rows: string[] = [];
for (const t of [...catalog.all].sort((a, b) => a.name.localeCompare(b.name))) {
  const call = golden[t.name] ?? {};
  const s = t.inputSchema as { properties?: Record<string, P>; required?: string[] };
  const raw = validateInput(t.cap, t.v, call);
  const filled = fillInput(t, call, ctx, 0);
  const via = validateInput(t.cap, t.v, filled.input);
  if (raw.length > 0) before++;
  if (via.length > 0) after++;
  const req = (s.required ?? []).map((k) => {
    const p = s.properties?.[k] ?? {};
    const shape = p.pattern
      ? `id ${p.pattern.replace(/\^|\$|\[a-z0-9\]\+/g, "").replace(/\\/g, "")}`
      : p.enum
        ? `one of ${p.enum.length}`
        : (p.type ?? "any");
    return `${k} (${shape})`;
  });
  const tools = t.keyed === true ? "key" : "";
  const fills = [
    ...(t.keyed === true ? ["idempotencyKey"] : []),
    ...filled.filled.filter((f) => f !== "idempotencyKey"),
  ];
  const limits = Object.entries(s.properties ?? {})
    .filter(([, p]) => p.maxLength !== undefined || p.maximum !== undefined)
    .map(([k, p]) => `${k} max ${p.maxLength ?? p.maximum}`);
  rows.push(
    `| ${t.name} | ${req.join(", ") || "none"} | ${fills.join(", ") || ""}${tools && fills.length === 0 ? "" : ""} | ${limits.join(", ")} | ${raw.length > 0 ? "no" : "yes"} | ${via.length > 0 ? "no" : "yes"} |`,
  );
}
console.log(
  `Tools in the catalog: ${catalog.all.length}. Naive first call accepted before the tool layer fills anything: ${catalog.all.length - before}. After: ${catalog.all.length - after}.\n`,
);
console.log(
  "| tool | required inputs a model writes | filled by the tool layer | size limits it is shown | accepted before | accepted after |",
);
console.log("|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
