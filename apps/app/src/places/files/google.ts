// Which Google app a file is and which provider a file or folder comes from: the words and choices behind the marks in marks.tsx, without a renderer.
import type { MarkKind } from "./mounts/icons.tsx";

export type GoogleApp = "gdocs" | "gsheets" | "gslides" | "gdrawings" | "gforms";

export const GOOGLE_APP_NAME: Readonly<Record<GoogleApp, string>> = { gdocs: "Google Docs", gsheets: "Google Sheets", gslides: "Google Slides", gdrawings: "Google Drawings", gforms: "Google Forms" };

/** What the Kind column says for a Google file. */
export const GOOGLE_KIND_WORD: Readonly<Record<GoogleApp, string>> = { gdocs: "Google Doc", gsheets: "Google Sheet", gslides: "Google Slides", gdrawings: "Google Drawing", gforms: "Google Form" };

const NATIVE: Readonly<Record<string, GoogleApp>> = { document: "gdocs", spreadsheet: "gsheets", presentation: "gslides", drawing: "gdrawings", form: "gforms" };

/**
 * The Google app a file is, or null. A Google-native file keeps Google's own type (application/vnd.google-apps.document); one made before that kept the type of its export (Markdown or
 * Word for a Doc, CSV or Excel for a Sheet, PDF for Slides, PNG for a Drawing), and one never opened read as plain text, which is taken as a Doc until it is opened.
 */
export function googleAppOf(file: { kind: string; mime?: string | undefined }): GoogleApp | null {
  if (file.kind !== "google_native") return null;
  const mime = (file.mime ?? "").toLowerCase();
  if (mime.startsWith("application/vnd.google-apps.")) return NATIVE[mime.slice("application/vnd.google-apps.".length)] ?? null;
  if (mime.includes("spreadsheetml") || mime === "text/csv") return "gsheets";
  if (mime.includes("presentationml") || mime === "application/pdf") return "gslides";
  if (mime.startsWith("image/")) return "gdrawings";
  return "gdocs";
}

/** The mark of the provider a file or folder comes from, by the provider's name as the server gives it ("Google Drive"); null for none, and for a folder on a computer. */
export function providerMarkOf(provider: string | null | undefined): Exclude<MarkKind, "local"> | null {
  const p = provider ?? "";
  if (/google/i.test(p)) return "google_drive";
  if (/sharepoint/i.test(p)) return "sharepoint";
  if (/onedrive/i.test(p)) return "onedrive";
  if (/microsoft/i.test(p)) return "microsoft";
  if (/dropbox/i.test(p)) return "dropbox";
  if (/github/i.test(p)) return "github";
  return null;
}
