// perf/budgets.json is the source of truth for tests and the Console speed page.

import fs from "node:fs";
import type { AlsoLimit, Budget, Sense } from "./types.ts";

const BUDGETS_URL = new URL("../budgets.json", import.meta.url);
const MACHINES = new Set(["mid laptop", "mid phone"]);
const SENSES = new Set<Sense>(["max", "min", "exact"]);

function fail(message: string): never {
  throw new Error(message);
}

function record(raw: unknown, at: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${at} must be an object`);
  return raw as Record<string, unknown>;
}

function text(raw: unknown, at: string): string {
  if (typeof raw !== "string" || raw.length === 0) fail(`${at} must be a non-empty string`);
  return raw;
}

function finite(raw: unknown, at: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) fail(`${at} must be a finite number >= 0`);
  return raw;
}

function senseOf(raw: unknown, at: string): Sense {
  if (typeof raw !== "string" || !SENSES.has(raw as Sense)) fail(`${at} must be max, min, or exact`);
  return raw as Sense;
}

function machineOf(raw: unknown, at: string): string {
  const machine = text(raw, at);
  if (!MACHINES.has(machine)) fail(`${at} must be mid laptop or mid phone`);
  return machine;
}

function parseAlso(raw: unknown, at: string): AlsoLimit {
  const row = record(raw, at);
  const parsed: AlsoLimit = { metric: text(row.metric, `${at}.metric`), p95: finite(row.p95, `${at}.p95`) };
  if (row.machine !== undefined) parsed.machine = machineOf(row.machine, `${at}.machine`);
  if (row.sense !== undefined) parsed.sense = senseOf(row.sense, `${at}.sense`);
  return parsed;
}

function parseBudget(raw: unknown, at: string): Budget {
  const row = record(raw, at);
  const budget: Budget = {
    id: text(row.id, `${at}.id`),
    metric: text(row.metric, `${at}.metric`),
    p50: finite(row.p50, `${at}.p50`),
    p95: finite(row.p95, `${at}.p95`),
    machine: machineOf(row.machine, `${at}.machine`),
    probe: text(row.probe, `${at}.probe`),
    unit: text(row.unit, `${at}.unit`),
    sense: senseOf(row.sense, `${at}.sense`),
  };
  if (budget.p50 > budget.p95) fail(`${at} p50 ${budget.p50} is above p95 ${budget.p95}`);
  if (budget.sense === "exact" && budget.p50 !== budget.p95) fail(`${at} exact budgets use one number`);
  if (row.also !== undefined) {
    if (!Array.isArray(row.also)) fail(`${at}.also must be an array`);
    budget.also = row.also.map((item, i) => parseAlso(item, `${at}.also[${i}]`));
  }
  return budget;
}

/** Parses the `{ budgets }` document. Duplicate ids and inverted percentiles throw. */
export function parseBudgets(raw: unknown): Budget[] {
  const doc = record(raw, "budgets.json");
  if (!Array.isArray(doc.budgets) || doc.budgets.length === 0) fail("budgets.json needs a budgets array");
  const seen = new Set<string>();
  return doc.budgets.map((item, i) => {
    const budget = parseBudget(item, `budgets[${i}]`);
    if (seen.has(budget.id)) fail(`duplicate budget id ${budget.id}`);
    seen.add(budget.id);
    return budget;
  });
}

/** Loads perf/budgets.json next to this harness. */
export function loadBudgets(): Budget[] {
  return parseBudgets(JSON.parse(fs.readFileSync(BUDGETS_URL, "utf8")));
}

/** Primary ceiling when metric and machine match, otherwise a named `also` ceiling. */
export function limitFor(budget: Budget, metric: string, machine = budget.machine): { p95: number; sense: Sense } | null {
  if (budget.metric === metric && budget.machine === machine) return { p95: budget.p95, sense: budget.sense };
  const extra = budget.also?.find((row) => row.metric === metric && (row.machine ?? budget.machine) === machine);
  if (!extra) return null;
  return { p95: extra.p95, sense: extra.sense ?? budget.sense };
}
