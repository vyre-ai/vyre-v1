// One handler per scheduler-api capability (18). Schedules and their clock work live in schedule.ts; background waits in waits.ts.
import { cancel, catchUp, fire, get, list, missed, nextTimes, pause, reschedule, resume, runNow, schedule, status } from "./schedule.ts";
import { cancelWait, expire, listWaits, match, register } from "./waits.ts";

export const handlers = {
  "scheduler.cancel": cancel,
  "scheduler.catch_up": catchUp,
  "scheduler.fire": fire,
  "scheduler.get": get,
  "scheduler.list": list,
  "scheduler.missed": missed,
  "scheduler.next_times": nextTimes,
  "scheduler.pause": pause,
  "scheduler.reschedule": reschedule,
  "scheduler.resume": resume,
  "scheduler.run_now": runNow,
  "scheduler.schedule": schedule,
  "scheduler.status": status,
  "scheduler.waits.cancel": cancelWait,
  "scheduler.waits.expire": expire,
  "scheduler.waits.list": listWaits,
  "scheduler.waits.match": match,
  "scheduler.waits.register": register,
};
