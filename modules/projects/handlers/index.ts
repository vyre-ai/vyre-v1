// Handler table of the projects module: all 22 capabilities of manifests/projects.ts. Making, reading, people and the Overview are in project.ts; the plan (stages, bars, arrows, task threads)
// is in plan.ts; the cascade proposed when something slips, and its Apply or Keep, is in cascade.ts.
import { applyCascade, cascade } from "./cascade.ts";
import { linkTasks, openTaskThread, plan, reschedule, stagesSet, unlinkTasks } from "./plan.ts";
import {
  create, fileChat, fromChannel, get, list, membersList, membersRemove, membersSet, overview, pinFile, postUpdate, shareOut, templatesList, unpinFile,
} from "./project.ts";

export const handlers = {
  "projects.apply_cascade": applyCascade,
  "projects.cascade": cascade,
  "projects.create": create,
  "projects.file_chat": fileChat,
  "projects.from_channel": fromChannel,
  "projects.get": get,
  "projects.link_tasks": linkTasks,
  "projects.list": list,
  "projects.members.list": membersList,
  "projects.members.remove": membersRemove,
  "projects.members.set": membersSet,
  "projects.open_task_thread": openTaskThread,
  "projects.overview": overview,
  "projects.pin_file": pinFile,
  "projects.plan": plan,
  "projects.post_update": postUpdate,
  "projects.reschedule": reschedule,
  "projects.share_out": shareOut,
  "projects.stages.set": stagesSet,
  "projects.templates.list": templatesList,
  "projects.unlink_tasks": unlinkTasks,
  "projects.unpin_file": unpinFile,
};
