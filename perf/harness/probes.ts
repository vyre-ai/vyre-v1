// Probe catalog. ARCH 3.7 output 17 names perf/generated/probes.json.
// tools/gen writes generated/probes.json. The ARCH path wins when it is present.

import fs from "node:fs";
import type { Budget, Probe } from "./types.ts";

const ARCH_PROBES = new URL("../generated/probes.json", import.meta.url);
const GENERATED_PROBES = new URL("../../generated/probes.json", import.meta.url);

function fail(message: string): never {
  throw new Error(message);
}

function parseProbe(raw: unknown, at: string): Probe {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${at} must be an object`);
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) fail(`${at}.id must be a non-empty string`);
  const probe: Probe = { id: row.id };
  if (typeof row.screen === "string") probe.screen = row.screen;
  if (typeof row.place === "string") probe.place = row.place;
  if (typeof row.firstPaintMs === "number") probe.firstPaintMs = row.firstPaintMs;
  if (typeof row.completeMs === "number") probe.completeMs = row.completeMs;
  if (Array.isArray(row.files)) probe.files = row.files.filter((f): f is string => typeof f === "string");
  return probe;
}

export function parseProbes(raw: unknown): Probe[] {
  if (!raw || typeof raw !== "object" || !("probes" in raw) || !Array.isArray((raw as { probes: unknown }).probes)) {
    fail("probes.json needs a probes array");
  }
  return (raw as { probes: unknown[] }).probes.map((item, i) => parseProbe(item, `probes[${i}]`));
}

/** `{ source, probes }`. `source` is perf/generated/probes.json or generated/probes.json. */
export function loadProbes(): { source: string; probes: Probe[] } {
  if (fs.existsSync(ARCH_PROBES)) {
    return { source: "perf/generated/probes.json", probes: parseProbes(JSON.parse(fs.readFileSync(ARCH_PROBES, "utf8"))) };
  }
  if (!fs.existsSync(GENERATED_PROBES)) fail("no probes.json at perf/generated/probes.json or generated/probes.json");
  return { source: "generated/probes.json", probes: parseProbes(JSON.parse(fs.readFileSync(GENERATED_PROBES, "utf8"))) };
}

/** Budget rows whose `probe` is missing from the catalog. Empty means the contract holds. */
export function budgetsMissingProbe(budgets: readonly Budget[], probes: readonly Probe[]): string[] {
  const ids = new Set(probes.map((probe) => probe.id));
  return budgets.filter((budget) => !ids.has(budget.probe)).map((budget) => `${budget.id} -> ${budget.probe}`);
}
