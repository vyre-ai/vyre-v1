// A code step runs its function body in a fresh vm context. The context is not given require, process, fetch, or files.
// node:vm is a timeout and a withheld global, not a kernel sandbox.
import vm from "node:vm";
import { stepError } from "../projections.ts";

const MAX_SOURCE = 20_000;
const MAX_LOGS = 50;
const MAX_LOG = 500;

export function runUserCode(source: string, input: unknown, timeoutMs = 10_000): { result: unknown; logs: string[] } {
  if (typeof source !== "string" || !source.trim()) throw stepError("validation.bad_input", "Run code needs source.", false);
  if (source.length > MAX_SOURCE) throw stepError("validation.bad_input", "Run code is longer than 20000 characters.", false);
  const logs: string[] = [];
  const log = (message: unknown): void => {
    if (logs.length >= MAX_LOGS) return;
    logs.push(String(message).slice(0, MAX_LOG));
  };
  const sandbox: { input: unknown; log: (message: unknown) => void; out?: unknown } = { input, log };
  vm.createContext(sandbox);
  const script = new vm.Script(`"use strict"; globalThis.out = (function(input, log) {\n${source}\n})(input, log);`);
  try {
    script.runInContext(sandbox, { timeout: timeoutMs });
  } catch (e) {
    const message = e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "The code did not run.";
    if (/timed out|Script execution/i.test(message)) throw stepError("timeout.deadline", "Run code took too long.", false);
    throw stepError("validation.bad_input", message, false);
  }
  try {
    const encoded = JSON.stringify(sandbox.out ?? null);
    if (typeof encoded !== "string") throw new Error("not json");
    return { result: JSON.parse(encoded) as unknown, logs };
  } catch (e) {
    if (e && typeof e === "object" && "error" in e) throw e;
    throw stepError("validation.bad_input", "Run code must return JSON.", false);
  }
}
