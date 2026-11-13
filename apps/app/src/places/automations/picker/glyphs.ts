// The glyph each of Vyre's own picker groups wears, drawn from the Automations icon set. An app is never listed here: an app wears its logo (ui/AppLogo).
import { PATHS } from "../canvas/icons.tsx";
import type { Mark } from "./model.ts";

const OF: Readonly<Record<string, readonly string[]>> = {
  msg: PATHS.mail,
  tasks: PATHS.task,
  files: PATHS.folder,
  docs: PATHS.sign,
  cal: PATHS.clock,
  records: PATHS.sheet,
  forms: PATHS.inbox,
  ai: PATHS.ai,
  logic: PATHS.branch,
  more: PATHS.more,
};

/** The paths to hand to AppLogo for a mark, or undefined for an app. */
export function glyphOf(mark: Mark): readonly string[] | undefined {
  return mark.app.startsWith("vyre:") ? (OF[mark.app.slice(5)] ?? PATHS.more) : undefined;
}
