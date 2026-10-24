// Handler table of the engine module for the capabilities this module implements so far. The rest of engine.* is served by the generated stubs
// until the packets that own them land (accounts and models P-L2_03, the turn worker's engine.turn.*, the pool P-L2_04, policy and review).
import { incidentAssign, incidentGet, incidentNote, incidentOpen, incidentResolve, incidentsList, interrupt, setMode, setModel, stop, stopAll, switchEngine } from "./control.ts";
import { capsSet, pauseAll, raiseLimit, recordUsage, resumeAll, spendGet, usageQuery } from "./spend.ts";

export const handlers = {
  "engine.interrupt": interrupt,
  "engine.stop": stop,
  "engine.stop_all": stopAll,
  "engine.set_mode": setMode,
  "engine.set_model": setModel,
  "engine.switch": switchEngine,
  "engine.incidents.list": incidentsList,
  "engine.incident.get": incidentGet,
  "engine.incident.open": incidentOpen,
  "engine.incident.assign": incidentAssign,
  "engine.incident.resolve": incidentResolve,
  "engine.incident.note": incidentNote,
  "engine.spend.get": spendGet,
  "engine.spend.caps.set": capsSet,
  "engine.spend.pause_all": pauseAll,
  "engine.spend.resume_all": resumeAll,
  "engine.spend.raise": raiseLimit,
  "engine.usage.query": usageQuery,
  "engine.turn.record_usage": recordUsage,
};

export { incidentOpen, openIncident } from "./control.ts";
export { isPaused } from "./spend.ts";
