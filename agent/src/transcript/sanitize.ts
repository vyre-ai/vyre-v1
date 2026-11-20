// The credential redactor now lives in lib/secret-scrub.ts so the server, the host and the agent share one set of rules (lane r42-mcp, 19 Nov 2026). Nothing changes for a caller: the same names, the same output.
export { PATTERNS, redact, scan } from "../../../lib/secret-scrub.ts";
export type { Redacted } from "../../../lib/secret-scrub.ts";
