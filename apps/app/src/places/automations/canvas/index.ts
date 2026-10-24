// automations.canvas and the place frame that holds it beside the sidebar.

export {
  addNode,
  addPaths,
  addTrigger,
  CHAIN_DEPTH_LIMIT,
  CONTROL_PALETTE,
  createEditor,
  readPaths,
  rootIds,
  setPathWhen,
  STEP_KEYS,
  stepTitle,
  takenLane,
  TRIGGER_PALETTE,
  triggerTitle,
  validateDefinition,
  WAIT_TIMEOUT_DEFAULT,
  withCanvasTab,
  withRun,
} from "./model.ts";
export type {
  AiBlock,
  Branch,
  CanvasDefinition,
  CanvasIssue,
  CanvasNode,
  CanvasRun,
  CanvasTab,
  Editor,
  EditorInit,
  PathBuild,
  PathStep,
  RunState,
  RunStep,
  TriggerRef,
  Validation,
} from "./model.ts";
export { densityFor, renderCanvas } from "./render.ts";
export { FRAME_WIDTHS, renderAutomationsPlace, renderShotDocument, SPACE_SKIN } from "./place.ts";
export type { CanvasSpace, FrameWidth, PlaceFrame } from "./place.ts";
