// Worker brief builder (ARCH 12.2 F13). Composes the tracker brief, the lane doc and the packet's file list
// into one prompt from docs/lanes/TEMPLATE.md, kept under MAX_TOKENS.
// CLI: node scripts/brief/build.ts <packet.json> [lane-doc.md]   (packet.json: BriefInput without laneDoc)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_TOKENS = 6000;

export type BriefInput = {
  id: string;
  title: string;
  /** Raw `trk brief <P>` output. */
  trackerBrief: string;
  /** Contents of docs/lanes/<lane>.md; trimmed first when the brief is too long. */
  laneDoc?: string;
  /** Owned globs, every one is listed verbatim. */
  owns: string[];
  spec?: string[];
  reuse?: string[];
  capabilities?: string[];
  interfaces?: string[];
  tests?: string[];
  budgets?: string[];
  proofs?: string[];
};

/** Rough token estimate: four characters per token, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const bullets = (xs: string[] | undefined, none: string): string =>
  xs && xs.length ? xs.map((x) => `- ${x}`).join("\n") : none;

/** The checklist block of a tracker brief, from the "CHECKLIST" line to the next blank line. */
export function checklistOf(trackerBrief: string): string {
  const m = /^CHECKLIST[^\n]*\n((?:[ \t]+\d+\.[^\n]*\n?)+)/m.exec(trackerBrief);
  return m ? m[1].trimEnd() : "(none in the tracker brief)";
}

/** Fills the template. `lane` is passed separately so the caller can fit it to the budget. */
export function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : ""));
}

export function buildBrief(input: BriefInput, template: string): string {
  const base: Record<string, string> = {
    goal: `${input.id}: ${input.title}`,
    spec: bullets(input.spec, "See the tracker brief."),
    owned: bullets(input.owns, "(none)"),
    reuse: bullets(input.reuse, "None listed."),
    capabilities: bullets(input.capabilities, "None."),
    interfaces: bullets(input.interfaces, "None."),
    tests: bullets(input.tests, "See the checklist."),
    budgets: bullets(input.budgets, "None beyond the 20 s per-test cap."),
    checklist: checklistOf(input.trackerBrief),
    proofs: (input.proofs && input.proofs.length ? input.proofs : ["test_run"]).join(", "),
  };
  const lane = (input.laneDoc ?? "").trim();
  const full = render(template, { ...base, lane });
  if (estimateTokens(full) <= MAX_TOKENS) return full;
  // Over budget: cut the lane doc to what fits; everything else stays whole.
  const empty = render(template, { ...base, lane: "" });
  const room = (MAX_TOKENS - estimateTokens(empty) - 20) * 4;
  if (room <= 0) throw new Error(`${input.id}: brief is over ${MAX_TOKENS} tokens even without the lane doc`);
  const cut = lane.slice(0, room).replace(/\s+\S*$/, "");
  return render(template, { ...base, lane: `${cut}\n\n(lane doc cut to fit the ${MAX_TOKENS}-token brief)` });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const root = path.join(path.dirname(self), "..", "..");
  const template = fs.readFileSync(path.join(root, "docs", "lanes", "TEMPLATE.md"), "utf8");
  const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as BriefInput;
  if (process.argv[3]) input.laneDoc = fs.readFileSync(process.argv[3], "utf8");
  process.stdout.write(buildBrief(input, template) + "\n");
}
