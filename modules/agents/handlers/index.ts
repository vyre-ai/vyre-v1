// Handler table of the agents module: all 32 capabilities of manifests/agents.ts. The record, lifecycle, configuration and versions are in crud.ts; routines, suggestions, the Agent template and
// Vyre's own text are in routines.ts.
import {
  configGet, configValidate, create, get, limitsGet, list, pause, remove, restore, restoreVersion, resume, roleLineSet, snapshotTake, status, summary, update, versions, visibilitySet,
} from "./crud.ts";
import { builtinSkillsList, guideGet, routineDelegate, routineDelete, routineRunNow, routineSave, routinesList, suggestionAccept, suggestionDismiss, suggestionPropose, suggestionsList, templateApply, templateGet, templatePreview } from "./routines.ts";

export const handlers = {
  "agents.list": list,
  "agents.get": get,
  "agents.status": status,
  "agents.summary": summary,
  "agents.create": create,
  "agents.update": update,
  "agents.role_line.set": roleLineSet,
  "agents.pause": pause,
  "agents.resume": resume,
  "agents.delete": remove,
  "agents.restore": restore,
  "agents.visibility.set": visibilitySet,
  "agents.config.get": configGet,
  "agents.config.validate": configValidate,
  "agents.limits.get": limitsGet,
  "agents.snapshot.take": snapshotTake,
  "agents.versions": versions,
  "agents.restore_version": restoreVersion,
  "agents.routines.list": routinesList,
  "agents.routine.save": routineSave,
  "agents.routine.delete": routineDelete,
  "agents.routine.run_now": routineRunNow,
  "agents.routine.delegate": routineDelegate,
  "agents.suggestions.list": suggestionsList,
  "agents.suggestion.propose": suggestionPropose,
  "agents.suggestion.accept": suggestionAccept,
  "agents.suggestion.dismiss": suggestionDismiss,
  "agents.template.get": templateGet,
  "agents.template.preview": templatePreview,
  "agents.template.apply": templateApply,
  "agents.guide.get": guideGet,
  "agents.builtin_skills.list": builtinSkillsList,
};
