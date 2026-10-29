// Local history is untrusted source material. This boundary runs before preview
// and again before persistence, including direct capability callers.
const REDACTED = "[REDACTED]";
const WRAPPERS = "environment_context|environment_details|environment_variables|user_instructions|instructions|system-reminder|system|developer";

export function sanitizeImportedText(text: string): string {
  let out = text;
  // Strip complete instruction/environment blocks. An unfinished block consumes
  // the remaining text rather than exposing a truncated private instruction.
  out = out.replace(new RegExp(`<(${WRAPPERS})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "");
  out = out.replace(new RegExp(`<(?:${WRAPPERS})(?:\\s[^>]*)?>[\\s\\S]*$`, "gi"), "");
  out = out.replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/g, REDACTED);
  // Dotenv and shell exports: preserve the variable name, never its value.
  out = out.replace(/(^|\n)([ \t]*(?:export[ \t]+)?[A-Z_][A-Z0-9_]*[ \t]*=)[^\r\n]*/g, `$1$2${REDACTED}`);
  // Common credential assignments in JSON, YAML and pasted prose.
  out = out.replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization|secret|token)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}\n]+)/gi, `$1${REDACTED}`);
  out = out.replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, REDACTED);
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, `Bearer ${REDACTED}`);
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  out = out.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      const changed = !!(url.username || url.password);
      url.username = ""; url.password = "";
      let queryChanged = false;
      for (const key of [...url.searchParams.keys()]) if (/(?:token|secret|password|api[_-]?key|signature|credential)/i.test(key)) { url.searchParams.set(key, REDACTED); queryChanged = true; }
      return changed || queryChanged ? url.toString() : raw;
    } catch { return REDACTED; }
  });
  return out.trim();
}
