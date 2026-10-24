// Builders for the steps-core tests.
import type { StepCall, StepNode } from "../handlers/control.ts";

export const NOW = 1_760_000_000_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const node = (id: string, key: string, input: Record<string, unknown> = {}, over: Partial<StepNode> = {}): StepNode => ({ id, key, input, ...over });
export const callOf = (over: Partial<StepCall> = {}): StepCall => ({ attempt: 1, key: "run_t1:s:1", outputs: {}, sandbox: false, resumed: false, ...over });
