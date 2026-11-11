// A test reporter that writes each failed test's error the moment it fails. Node's spec reporter prints the details of every failure only in its end summary, so a file that fails a test
// and then never exits (a daemon or a browser left open) is killed by the watchdog with the details never printed: the log said which test failed and nothing about why.
// test-run.ts runs this beside the spec reporter. Every line starts with "failure detail>" so nothing that reads the spec output mistakes it for a result.

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)} ...` : s);

/** @param {AsyncIterable<{ type: string, data: any }>} source */
export default async function* failureReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:fail") continue;
    const d = event.data;
    const error = d?.details?.error;
    // node wraps what a test threw in a "test failed" error whose cause is the real one
    const real = error?.cause && typeof error.cause === "object" ? error.cause : error;
    const message = String(real?.message ?? error?.message ?? "no message");
    const stack = typeof real?.stack === "string" ? real.stack.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 4).join("\n") : "";
    const lines = [`failure detail> ${d?.name ?? "a test"} (${d?.file ?? ""})`, ...clip(message, 4000).split("\n").map((l) => `failure detail>   ${l}`)];
    if (stack) lines.push(...stack.split("\n").map((l) => `failure detail> ${l}`));
    yield `${lines.join("\n")}\n`;
  }
}
