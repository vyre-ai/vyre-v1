// One handler per runs capability. Lifecycle, step log, waits and reads live in engine.ts; undo and its preview in undo.ts.
import { count, finish, get, list, markWaitingCap, pinVersion, recordKey, recordStep, replay, resume, retry, start, status, steps, stop, waitFor } from "./engine.ts";
import { previewUndo, undo } from "./undo.ts";
import { erase, purge } from "./purge.ts";

export const handlers = {
  "runs.erase": erase,
  "runs.purge": purge,
  "runs.count": count,
  "runs.finish": finish,
  "runs.get": get,
  "runs.list": list,
  "runs.mark_waiting": markWaitingCap,
  "runs.pin_version": pinVersion,
  "runs.preview_undo": previewUndo,
  "runs.record_key": recordKey,
  "runs.record_step": recordStep,
  "runs.replay": replay,
  "runs.resume": resume,
  "runs.retry": retry,
  "runs.start": start,
  "runs.status": status,
  "runs.steps": steps,
  "runs.stop": stop,
  "runs.undo": undo,
  "runs.wait_for": waitFor,
};
