// A press behind the truth: someone decided already, here or on another device. The server says "Already decided." and every surface says the same words, in place of a retry that can never work.
export const DECIDED_LINE = "Already decided.";
export const isDecided = (e: unknown): boolean => /already decided/i.test(String((e as { message?: unknown } | null)?.message ?? ""));
