export interface DoctorFinding { key: string; state: string; detail?: string; next?: string }
export interface Verdict { ok: boolean; why: string }
export function verdict(report: unknown, env?: Record<string, string | undefined>): Verdict;
export function doctorRole(env: Record<string, string | undefined>): "space" | "device";
export function check(env?: Record<string, string | undefined>): Promise<Verdict>;
