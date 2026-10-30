// One handler per steps-core capability (2). The steps themselves are run through `runStep` (control.ts), which the Run executor calls.
import { stepsTest } from "./control.ts";
import { stepsSupport } from "./support.ts";

export const handlers = {
  "steps.test": stepsTest,
  "steps.support": stepsSupport,
};
