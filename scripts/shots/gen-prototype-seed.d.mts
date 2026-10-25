export const OUT: string;
export const SPACES: readonly (readonly [string, string])[];
export function protoText(): string;
export function runSeed(): Record<string, { files: { N: Record<string, { name: string; dir: boolean }>; SHARED: unknown[]; HOME_ID: string; SIDE_IDS: string[] }; records: { TY: Record<string, { rows?: unknown[]; n: string }>; TYHUE: Record<string, number>; TYICON: Record<string, string> } }>;
