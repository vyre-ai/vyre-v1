// Slow by rule, not by list: a golden flow step boots a daemon and several modules, so every one of them is over the 30 s fast cap when many shards share a host. Rather than list the twenty-one
// files one by one in test/slow.json (and grow its cap with every new step), a path pattern makes a file slow with the golden cap. The sharder and both runners add these entries to the list.
export const SLOW_PATTERNS = [/^golden\/steps\/[^/]+\.test\.[cm]?[jt]s$/];
export const PATTERN_CAP_SEC = 120;

/** The slow list plus an entry for each of `files` that matches a slow pattern and is not already listed. @param {string[]} files @param {{ file: string }[]} slow */
export function withPatternSlow(files, slow) {
  const listed = new Set(slow.map((s) => s.file));
  const extra = [...new Set(files)].filter((f) => !listed.has(f) && SLOW_PATTERNS.some((re) => re.test(f))).map((file) => ({ file, capSec: PATTERN_CAP_SEC, owner: "L11", reason: "a golden step boots a daemon (slow by pattern, scripts/lib/slow-list.mjs)" }));
  return extra.length ? [...slow, ...extra] : slow;
}
