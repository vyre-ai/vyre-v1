// One handler per journeys capability (16). Design, start, stages and limits live in stages.ts; the migration and its preview in migrate.ts.
import { migrate, previewMigrate } from "./migrate.ts";
import { advance, checkLimits, create, design, get, list, moveStage, remove, rename, rulesSet, stageCounts, start, tasksOf, versions } from "./stages.ts";

export const handlers = {
  "journeys.advance": advance,
  "journeys.check_limits": checkLimits,
  "journeys.create": create,
  "journeys.delete": remove,
  "journeys.design": design,
  "journeys.get": get,
  "journeys.list": list,
  "journeys.migrate": migrate,
  "journeys.move_stage": moveStage,
  "journeys.preview_migrate": previewMigrate,
  "journeys.rename": rename,
  "journeys.rules.set": rulesSet,
  "journeys.stage_counts": stageCounts,
  "journeys.start": start,
  "journeys.tasks": tasksOf,
  "journeys.versions": versions,
};
