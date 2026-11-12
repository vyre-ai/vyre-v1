// What update-proof.ts --kept-profile decides from the new app's log on its first start over the shipped app's profile. Its own file so the decision is unit tested
// (apps/desktop/tests/upgrade-verdict.test.ts) with real logs, including a window left blank on purpose: the proof must fail on a blank window and say what it showed.

/** Everything the shell said from the first removal on. The removal can be said more than once in one start (run 43109353813 said it twice, then drew 132 chars), so this is the whole
 *  rest of the log, never the piece between two removals. */
export function sinceRemoval(log: string): string {
  const at = log.indexOf("page serviceworker: removed");
  return at < 0 ? "" : log.slice(at);
}

/** The page's render reports after the removal, in order. */
export const rendersAfter = (log: string): number[] => [...sinceRemoval(log).matchAll(/page rendered: (\d+) chars/g)].map((m) => Number(m[1]));

/** removed: the removal was seen; firstLook: the render reports at the first look, about 3 s before the log was read for the last time. */
export function upgradeVerdict(o: { removed: boolean; firstLook: number[]; log: string }): { lines: string[]; failures: string[] } {
  const said = sinceRemoval(o.log);
  const later = rendersAfter(o.log);
  const after = later.at(-1) ?? 0;
  const removals = (said.match(/page serviceworker: removed/g) ?? []).length;
  const recovered = said.split("\n").filter((l) => /page recover /.test(l));
  const lines = [`first start over the shipped app's profile: worker removed=${o.removed}, then ${after} chars (every report after the removal: ${later.join(", ") || "none"}; at the first look: ${o.firstLook.join(", ") || "none"}); removals said ${removals} time(s); the page loaded itself again ${recovered.filter((l) => !/refused/.test(l)).length} time(s)`];
  for (const l of recovered) lines.push(`  ${l.trim()}`);
  const failures: string[] = [];
  if (o.firstLook.length > 0 && o.firstLook[0] === 0 && after > 0) lines.push("NOTE the page reported 0 before it drew; a blank flash on the first start over an old profile");
  if (recovered.some((l) => /page recover blank/.test(l)) && after > 0) lines.push("NOTE it drew only after the shell's blank-window recovery loaded it again");
  if (!o.removed) failures.push("upgrade: the earlier version's service worker was not removed");
  if (recovered.some((l) => /refused/.test(l))) failures.push("upgrade: the page kept loading itself again until the shell refused");
  if (after === 0) {
    failures.push("upgrade: the app draws nothing after removing the earlier worker");
    // what the WebView held when nothing was drawn (PAGE_PROBE's "page blank" lines: address, readyState, title, elements, size, which worker served it, the notice), then the shell's own words
    const blank = said.split("\n").filter((l) => /page blank:/.test(l));
    lines.push(`what the window showed: ${blank.length ? blank.map((l) => l.trim()).join(" | ") : "no blank report (the page never ran the shell's probe 8 s after a load)"}`);
    lines.push(`the shell said, from the first removal on:\n${said.split("\n").slice(0, 40).join("\n")}`);
  }
  return { lines, failures };
}
