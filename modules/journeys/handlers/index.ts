// One handler per journeys capability (16). Design, start, stages and limits live in stages.ts; the migration and its preview in migrate.ts.
import { migrate, previewMigrate } from "./migrate.ts";
import { adopt, migrationState, toPipeline } from "./pipeline.ts";
import { testPath, where } from "./path.ts";
import {
  advance,
  checkLimits,
  create,
  design,
  get,
  list,
  moveStage,
  remove,
  rename,
  rulesSet,
  stageCounts,
  start,
  tasksOf,
  versions,
} from "./stages.ts";

export const handlers = {
  "journeys.adopt": adopt,
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
  "journeys.migration_state": migrationState,
  "journeys.stage_counts": stageCounts,
  "journeys.start": start,
  "journeys.tasks": tasksOf,
  "journeys.to_pipeline": toPipeline,
  "journeys.test_path": testPath,
  "journeys.versions": versions,
  "journeys.where": where,
};
