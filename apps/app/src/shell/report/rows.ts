// The "What is sent" list: one line per bundle field, in the order of the prototype sheet, plus the fixed "Left out" line.
// A test holds this list to the bundle's fields, so a field cannot be sent without being shown.
import type { Bundle } from "./bundle.ts";

export interface PreviewRow {
  /** The bundle field this line shows, or "left_out" for the fixed note. */
  field: keyof Bundle | "left_out";
  label: string;
  value: string;
}

export const LEFT_OUT = "Secrets never leave. Restricted values appear as [Restricted: label].";

const join = (parts: readonly string[]): string => parts.join(", ");

export function previewRows(b: Bundle, placeName: string, win: { width: number; height: number } | null = null): PreviewRow[] {
  const where = `${placeName} · ${b.context.itemId ?? "no item"}${b.context.hash ? ` · #${b.context.hash}` : ""}`;
  const size = win ? ` · window ${win.width}×${win.height}` : "";
  const out: PreviewRow[] = [
    { field: "context", label: "Where", value: where },
    { field: "traceIds", label: "Last 20 trace ids", value: b.traceIds.length ? join(b.traceIds) : "None yet" },
    { field: "events", label: "Recent events", value: b.events.length ? join(b.events.map((e) => e.type)) : "None" },
    { field: "errors", label: "Recent errors", value: b.errors?.length ? join(b.errors.map((e) => `${e.code}: ${e.message}`)) : "None in the last hour" },
    { field: "versions", label: "Versions", value: `App ${b.versions.app} · server ${b.versions.server}` },
    { field: "screenshotFileId", label: "Screenshot", value: b.screenshotFileId ? `This window${size} (attached)` : "Not attached" },
    { field: "clientLogFileId", label: "Local log", value: b.clientLogFileId ? "Last 200 lines of the ring buffer" : "Not attached" },
  ];
  out.splice(5, 0, { field: "versions", label: "Device", value: `${b.versions.device}${size}` });
  if (b.note) out.push({ field: "note", label: "What went wrong", value: b.note });
  out.push({ field: "left_out", label: "Left out", value: LEFT_OUT });
  return out;
}
