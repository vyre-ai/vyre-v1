// The glyph each of Vyre's own picker groups wears, drawn from the Automations icon set. An app is never listed here: an app wears its logo (ui/AppLogo).
import { SHELL_ICONS } from "../../../shell/rail/icons.tsx";
import { PATHS } from "../canvas/icons.tsx";
import type { Mark } from "./model.ts";

const OF: Readonly<Record<string, readonly string[]>> = {
  msg: SHELL_ICONS.chats,
  mail: PATHS.mail,
  chat: SHELL_ICONS.chats,
  phone: PATHS.phone,
  sms: SHELL_ICONS.chats,
  wait: PATHS.clock,
  ask: ["M5.8 6.2a2.2 2.2 0 114 .9c0 1.4-2 1.5-2 3.1M7.8 12.6v.4"],
  loop: ["M3 8a5 5 0 019-3M12 2v3H9M13 8a5 5 0 01-9 3M4 14v-3h3"],
  tasks: PATHS.task,
  files: SHELL_ICONS.files,
  docs: PATHS.sign,
  cal: PATHS.clock,
  records: SHELL_ICONS.records,
  forms: PATHS.inbox,
  ai: PATHS.ai,
  logic: PATHS.branch,
  more: PATHS.more,
  plug: ["M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 01-7 0zM8 11.5V14"],
};

/** The paths to hand to AppLogo for a mark, or undefined for an app. */
export function glyphOf(mark: Mark): readonly string[] | undefined {
  return mark.app.startsWith("vyre:") ? (OF[mark.app.slice(5)] ?? PATHS.more) : undefined;
}

const TINT: Readonly<Record<string, string>> = {
  msg: "#4f7bf5",
  mail: "#4f7bf5",
  chat: "#4f7bf5",
  phone: "#4f7bf5",
  sms: "#4f7bf5",
  wait: "#e89a0c",
  ask: "#8b5cf6",
  loop: "#6b7280",
  tasks: "#e89a0c",
  files: "#3b82f6",
  docs: "#8b5cf6",
  cal: "#3b82f6",
  records: "#14a38b",
  forms: "#7c5cdb",
  ai: "#d946a8",
  logic: "#6b7280",
  more: "#6b7280",
  plug: "#6b7280",
};

/** The fill of a Vyre group's tile. */
export function tintOf(mark: Mark): string | undefined {
  return mark.app.startsWith("vyre:") ? (TINT[mark.app.slice(5)] ?? "#6b7280") : undefined;
}
