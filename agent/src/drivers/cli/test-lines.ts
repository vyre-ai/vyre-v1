/** The lines of a tool's printed output that say how a test run went (counts, failing names), the last twelve at most; nothing else of the output is kept. Empty when there are none. */
export function testLines(text: string): string {
  return text.split("\n").map((l) => l.trim()).filter((l) => /^(?:ℹ\s+(?:pass|fail)\s+\d+|✖\s+\S|not ok\b|FAIL\b|Tests:)/i.test(l) || /\b\d+\s+(?:passed|passing|failed|failing)\b/i.test(l)).slice(-12).join("\n").slice(0, 500);
}
