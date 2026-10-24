// One handler per tasks capability (25). State changes and reads live in state.ts; act, delegate, escalate and stuck detection in act.ts.
import { act, delegate, escalate } from "./act.ts";
import {
  assign, countNeedsYou, create, dependenciesAdd, dependenciesRemove, followersAdd, followersRemove, get, history, linksAdd, linksRemove, list, myWorkList,
  needsYouList, notesDelete, notesSet, release, snooze, take, transition, update, withdraw,
} from "./state.ts";

export const handlers = {
  "tasks.act": act,
  "tasks.assign": assign,
  "tasks.count_needs_you": countNeedsYou,
  "tasks.create": create,
  "tasks.delegate": delegate,
  "tasks.dependencies.add": dependenciesAdd,
  "tasks.dependencies.remove": dependenciesRemove,
  "tasks.escalate": escalate,
  "tasks.followers.add": followersAdd,
  "tasks.followers.remove": followersRemove,
  "tasks.get": get,
  "tasks.history": history,
  "tasks.links.add": linksAdd,
  "tasks.links.remove": linksRemove,
  "tasks.list": list,
  "tasks.my_work": myWorkList,
  "tasks.needs_you": needsYouList,
  "tasks.release": release,
  "tasks.snooze": snooze,
  "tasks.take": take,
  "tasks.transition": transition,
  "tasks.update": update,
  "tasks.withdraw": withdraw,
  "tasks.working_notes.delete": notesDelete,
  "tasks.working_notes.set": notesSet,
};
