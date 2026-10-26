// Slow by rule, not by list: a test that boots a daemon (and several modules) is over the 30 s fast cap when many shards share a host. Rather than list the files one by one in test/slow.json (and
// grow its cap with every new one), a rule makes a file slow with the golden cap. The sharder and both runners add these entries to the list.
//   by path     golden/steps/*.test.*, any *.live.test.* and any *.booted.test.*
//   by content  a test that calls the daemon boot helpers (startDaemon, startSeeded, bootDaemon, bootFlowSpace, bootSmall, bootPerf, bootPrototype)
export const SLOW_PATTERNS = [/^golden\/steps\/[^/]+\.test\.[cm]?[jt]sx?$/, /\.live\.test\.[cm]?[jt]sx?$/, /\.booted\.test\.[cm]?[jt]sx?$/];
export const BOOT_HELPERS = /\b(?:startDaemon|startSeeded|bootDaemon|bootFlowSpace|bootSmall|bootPerf|bootPrototype)\b/;
export const PATTERN_CAP_SEC = 120;

const isTest = (f) => /\.test\.[cm]?[jt]sx?$/.test(f);

/**
 * The slow list plus an entry for each of `files` that matches a slow rule and is not already listed.
 * @param {string[]} files @param {{ file: string }[]} slow @param {(file: string) => string} [read] file text, for the by-content rule; without it only the path rules apply
 */
export function withPatternSlow(files, slow, read) {
  const listed = new Set(slow.map((s) => s.file));
  const booted = (f) => {
    if (!read || !isTest(f)) return false;
    try { return BOOT_HELPERS.test(read(f)); } catch { return false; }
  };
  const extra = [...new Set(files)].filter((f) => !listed.has(f) && (SLOW_PATTERNS.some((re) => re.test(f)) || booted(f)))
    .map((file) => ({ file, capSec: PATTERN_CAP_SEC, owner: "L11", reason: "boots a daemon (slow by rule, scripts/lib/slow-list.mjs)" }));
  return extra.length ? [...slow, ...extra] : slow;
}
