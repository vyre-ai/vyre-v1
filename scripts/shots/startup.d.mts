export const BUDGET_MS: { desktop: number; phone: number };
export const CPU: { desktop: number; phone: number };
export function chunkSizes(dist: string): { file: string; raw: number; gzip: number }[];
export function entryScripts(dist: string): string[];
export function median(a: (number | null)[]): number | null;
export function report(dist: string): { chunks: { file: string; raw: number; gzip: number }[]; total: number; totalGz: number; entryRaw: number; entryGz: number; text: string };
export function main(argv: string[]): Promise<void>;
export function weights(dist: string): { name: string; bytes: number }[];
