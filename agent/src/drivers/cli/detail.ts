// What a tool call touches, in a few safe words, for the live line ("Reading model.ts", "Searching the web: stream pacing"). The engine's tool input is the person's work and may hold secrets, so only a few
// shapes are ever read and everything else is "": a file's basename, a search query or pattern, a page's host. A Bash command, a URL's path or query, and anything that looks like a secret are never shown.
import { redact } from "../../transcript/sanitize.ts";

const MAX = 60;
const SECRETY_FILE = /(^|[._-])(env|secret|secrets|credential|credentials|token|tokens|id_rsa|id_ed25519|key|keys|pem|p12|pfx|npmrc|netrc|pgpass|htpasswd)([._-]|$)/i;
const SECRETY_TEXT = /(sk-[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{6,}|AKIA[0-9A-Z]{8,}|AIza[0-9A-Za-z_-]{10,}|eyJ[A-Za-z0-9_-]{10,}|Bearer\s+\S+|[A-Za-z0-9+/_=-]{32,}|(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=])/i;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function clean(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one === "" || SECRETY_TEXT.test(one)) return "";
  if (redact(one).text !== one) return "";
  return one.length > MAX ? `${one.slice(0, MAX - 3)}...` : one;
}

/** The detail of one tool call, or "" when there is nothing safe to say. `name` is the CLI's tool name. */
export function toolDetail(name: string, input: unknown): string {
  const i = rec(input);
  switch (name) {
    case "Read": case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": {
      const p = str(i["file_path"]) || str(i["notebook_path"]) || str(i["path"]);
      const base = p.split(/[\\/]/).filter(Boolean).pop() ?? "";
      return base === "" || SECRETY_FILE.test(base) ? "" : clean(base);
    }
    case "Glob": return clean(str(i["pattern"]));
    case "Grep": return clean(str(i["pattern"]));
    case "WebSearch": return clean(str(i["query"]));
    case "WebFetch": {
      try { const h = new URL(str(i["url"])).hostname; return clean(h); } catch { return ""; }
    }
    default: return "";
  }
}
