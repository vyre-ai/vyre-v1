// One handler per steps-core capability (1). The steps themselves are run through `runStep` (control.ts), which the Run executor calls.
import { stepsTest } from "./control.ts";

export const handlers = {
  "steps.test": stepsTest,
};
