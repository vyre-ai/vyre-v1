import { liveTurns } from "./bridge.ts";
// Handler table of the engine module for the capabilities this module implements so far. The rest of engine.* is served by the generated stubs
// until the packets that own them land (the turn worker's engine.turn.*, the pool P-L2_04, models, policy and review).
import { complete } from "./complete.ts";
import { accountProbe, accountResolve, accountsList } from "./accounts.ts";
import { incidentAssign, incidentGet, incidentNote, incidentOpen, incidentResolve, incidentsList, dropQueued, interrupt, setMode, setModel, steer, stop, stopAll, switchEngine } from "./control.ts";
import { extraHandlers } from "./extra/index.ts";
import { mcpCall, mcpTools, mcpOauthComplete, mcpOauthStart, mcpOauthStatus } from "./mcp.ts";
import { stepTurn } from "../step-turn.ts";
import { usageGet } from "./usage.ts";
import { list as crewList, merge as crewMerge, message as crewMessage, push as crewPush, repoGet as crewRepoGet, repoSet as crewRepoSet, start as crewStart, stop as crewStop, wait as crewWait, workspace as crewWorkspace } from "./crew.ts";
import { capsSet, pauseAll, raiseLimit, recordUsage, resumeAll, spendGet, usageQuery } from "./spend.ts";

export const handlers = {
  "engine.accounts.list": accountsList,
  "engine.complete": complete,
  "engine.step_turn": stepTurn as never,
  "engine.account.resolve": accountResolve,
  "engine.probe_account": accountProbe,
  "engine.interrupt": interrupt,
  "engine.drop_queued": dropQueued,
  "engine.steer": steer,
  "engine.stop": stop,
  "engine.stop_all": stopAll,
  "engine.live_turns": liveTurns,
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
  "engine.usage.get": usageGet as never,
  "engine.turn.record_usage": recordUsage,
  "engine.crew.repo.set": crewRepoSet,
  "engine.crew.repo.get": crewRepoGet,
  "engine.crew.start": crewStart,
  "engine.crew.list": crewList,
  "engine.crew.workspace": crewWorkspace,
  "engine.crew.wait": crewWait,
  "engine.crew.message": crewMessage,
  "engine.crew.stop": crewStop,
  "engine.crew.merge": crewMerge,
  "engine.crew.push": crewPush,
  "engine.mcp.tools": mcpTools,
  "engine.mcp.read": mcpCall,
  "engine.mcp.call": mcpCall,
  "engine.mcp.oauth_start": mcpOauthStart,
  "engine.mcp.oauth_complete": mcpOauthComplete,
  "engine.mcp.oauth_status": mcpOauthStatus,
  ...extraHandlers,
};

export { incidentOpen, openIncident } from "./control.ts";
export { isPaused } from "./spend.ts";
