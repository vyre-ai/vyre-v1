// One handler per goals capability.
import {
  activityList, ask, brief, checklistTick, complete, confirm, create, extend, finish, folder, get, go, list, markStuck, numberSet, pause, plan, progress, report, resume, searchPast, sources, step, stop,
  update, wakeClaim,
} from "./caps.ts";

export const handlers = {
  "goals.activity": activityList,
  "goals.ask": ask,
  "goals.brief": brief,
  "goals.checklist.tick": checklistTick,
  "goals.complete": complete,
  "goals.confirm": confirm,
  "goals.create": create,
  "goals.extend": extend,
  "goals.finish": finish,
  "goals.folder": folder,
  "goals.get": get,
  "goals.go": go,
  "goals.list": list,
  "goals.mark_stuck": markStuck,
  "goals.number.set": numberSet,
  "goals.pause": pause,
  "goals.plan": plan,
  "goals.progress": progress,
  "goals.report": report,
  "goals.resume": resume,
  "goals.search_past": searchPast,
  "goals.sources": sources,
  "goals.step": step,
  "goals.stop": stop,
  "goals.update": update,
  "goals.wake_claim": wakeClaim,
};
