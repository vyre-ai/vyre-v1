// The sidebar's words for a moment, taken from the chat's one formatter (conversation/model.ts: the message rows' timeLabel), so a goal's check-in reads the same clock as a message.
import { timeLabel, weekdayShort } from "../conversation/model.ts";
import type { Clock } from "../conversation/model.ts";
import type { SayWhen } from "./side-data.ts";

export const sayWhen = (c: Clock): SayWhen => ({
  weekday: (at) => weekdayShort(at, c),
  time: (at) => timeLabel(at, c),
});
