// Handler table of the projects module: all capabilities of manifests/projects.ts. Making, reading, people and the Overview are in project.ts; the plan (stages, bars, arrows, task threads)
// is in plan.ts; the cascade proposed when something slips, and its Apply or Keep, is in cascade.ts.
import { applyCascade, cascade } from "./cascade.ts";
import { linkTasks, openTaskThread, plan, reschedule, stagesSet, unlinkTasks } from "./plan.ts";
import {
  archive, create, fileChat, fromChannel, get, list, rolesOf, unarchive, membersList, membersRemove, membersSet, overview, pinFile, postUpdate, shareOut, sharedView, unshareOut, templatesList, unpinFile,
} from "./project.ts";
import { recordFilesFolder } from "./folders.ts";
import { link, linksList, rulesSet, unlink } from "./attach.ts";
import { docGet, docSave, edit as overviewEdit, history as overviewHistory, liveQuery, overviewGet, templateApply, templateSave, templatesList as pageTemplatesList, undo as overviewUndo } from "./overview.ts";
import { crew, forChannel, set, updateDraft, updateEdit } from "./upkeep.ts";
import { teammatesCreate, teammatesList, teammatesRemove } from "./teammates.ts";

export const handlers = {
  "projects.files_folder": (ctx: never, input: { type?: string; recordId: string; create?: boolean }) => recordFilesFolder(ctx, input),
  "projects.teammates.create": teammatesCreate,
  "projects.teammates.list": teammatesList,
  "projects.teammates.remove": teammatesRemove,
  "projects.crew": crew,
  "projects.live_block.query": liveQuery,
  "projects.overview_doc.apply_template": templateApply,
  "projects.overview_doc.get": docGet,
  "projects.overview_doc.history": overviewHistory,
  "projects.overview_doc.save": docSave,
  "projects.overview_doc.templates.list": pageTemplatesList,
  "projects.overview_doc.templates.save": templateSave,
  "projects.overview_doc.undo": overviewUndo,
  "projects.overview_edit": overviewEdit,
  "projects.overview_get": overviewGet,
  "projects.for_channel": forChannel,
  "projects.links.link": link,
  "projects.links.list": linksList,
  "projects.links.rules.set": rulesSet,
  "projects.links.unlink": unlink,
  "projects.set": set,
  "projects.update.draft": updateDraft,
  "projects.update.edit": updateEdit,
  "projects.apply_cascade": applyCascade,
  "projects.archive": archive,
  "projects.unarchive": unarchive,
  "projects.cascade": cascade,
  "projects.create": create,
  "projects.file_chat": fileChat,
  "projects.from_channel": fromChannel,
  "projects.get": get,
  "projects.link_tasks": linkTasks,
  "projects.list": list,
  "projects.roles_of": rolesOf,
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
  "projects.unshare_out": unshareOut,
  "projects.shared_view": sharedView,
  "projects.stages.set": stagesSet,
  "projects.templates.list": templatesList,
  "projects.unlink_tasks": unlinkTasks,
  "projects.unpin_file": unpinFile,
};
