// The strict guard for the fakes of records.* and tasks.* (packages/contracts/src/contract-check.ts strictGuard), bound to the generated registry and validators.
import { strictGuard, STRICT_PREFIXES } from "../../packages/contracts/src/contract-check.ts";
import { registry } from "../../generated/registry.ts";
import { validateInput } from "../../generated/validators.ts";

export { STRICT_PREFIXES };
export const assertStrictInput: (cap: string, input: unknown) => void = strictGuard(registry, validateInput);

/** The validation errors one call would get; empty when it passes or the capability is not checked. */
export function strictInputErrors(cap: string, input: unknown): string[] {
  try { assertStrictInput(cap, input); return []; } catch (e) { return (e as { error: { errors: string[] } }).error.errors; }
}
