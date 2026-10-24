// Load perf/budgets.json. Source of truth for the harness and the Console speed page.

import fs from "node:fs";
import path from "node:path";
import type { Budget, Machine } from "./types.ts";

export const BUDGETS_FILE = "perf/budgets.json";

const MACHINES = new Set<Machine>(["mid laptop", "mid phone"]);

function isMachine(v: string): v is Machine {
  return MACHINES.has(v as Machine);
}

/** Reads and checks every row. p50 may equal p95 (a point budget). p50 above p95 is rejected. */
export function loadBudgets(root: string): Budget[] {
  const raw = JSON.parse(fs.readFileSync(path.join(root, BUDGETS_FILE), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${BUDGETS_FILE} is an array of rows`);
  const seen = new Set<string>();
  return raw.map((row, i) => {
    if (!row || typeof row !== "object") throw new Error(`${BUDGETS_FILE}[${i}] is not an object`);
    const r = row as Record<string, unknown>;
    const id = r.id;
    const metric = r.metric;
    const p50 = r.p50;
    const p95 = r.p95;
    const machine = r.machine;
    if (typeof id !== "string" || !id) throw new Error(`${BUDGETS_FILE}[${i}] needs id`);
    if (typeof metric !== "string" || !metric) throw new Error(`${BUDGETS_FILE}[${i}] needs metric`);
    if (typeof p50 !== "number" || !Number.isFinite(p50)) throw new Error(`${BUDGETS_FILE}[${i}] needs numeric p50`);
    if (typeof p95 !== "number" || !Number.isFinite(p95)) throw new Error(`${BUDGETS_FILE}[${i}] needs numeric p95`);
    if (typeof machine !== "string" || !isMachine(machine)) throw new Error(`${BUDGETS_FILE}[${i}] machine is mid laptop or mid phone`);
    if (p50 > p95) throw new Error(`${BUDGETS_FILE}[${i}] p50 ${p50} is above p95 ${p95}`);
    const key = `${id}\0${machine}`;
    if (seen.has(key)) throw new Error(`${BUDGETS_FILE} duplicate ${id} on ${machine}`);
    seen.add(key);
    return { id, metric, p50, p95, machine };
  });
}
