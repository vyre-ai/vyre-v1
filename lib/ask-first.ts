// Which outward steps of an Automation wait for a person's yes before they go out, when the step does not say (rc.41). A step that says On asks, a step that says Off does not; a step that says nothing
// asks when its act is one the Gate marks high risk and that reaches someone outside (a signature request today, a payment when a step for one exists). Everything else goes out on the standing yes its
// author gave by saving or turning the Automation on. One rule for the server (steps-core), the builder's switch and the words that describe a flow, so they cannot disagree.
// test/ask-first.test.ts holds this list to the Gate's own table: a new high-risk outward act fails it until it is added here.
export const ASK_FIRST_ACTS: ReadonlySet<string> = new Set(["signature_send", "pay"]);

/** Does this step wait for a yes? `flag` is the step's own "Ask before sending" (absent when nobody chose), `act` the Gate act of its capability. */
export function asksFirst(flag: boolean | undefined, act: string | undefined): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return act !== undefined && ASK_FIRST_ACTS.has(act);
}
