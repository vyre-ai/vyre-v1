// "Open in Google Docs / Word / Excel / Dropbox" for a file that comes from a mounted folder (live folders L3). The provider's own editor opens the same file: Vyre shows its preview and the provider
// edits it. The address comes from the provider (mounts.file_link) at the moment of the press, so it is the file's current one and a person who cannot open the file there gets no link; the words on the
// menu item are worked out from what the row already knows (the provider's name, the file's name and kind), so the menu opens at once.

/** What mounts.file_link answers for a file that has a provider address. */
export interface FileLink { openIn: string; webUrl: string; type: string; edit: readonly string[] }

type Call = (cap: string, input: unknown) => Promise<unknown>;

const OFFICE: Readonly<Record<string, string>> = { doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", xlsm: "Excel", ppt: "PowerPoint", pptx: "PowerPoint" };

const extOf = (name: string): string => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/**
 * What a row's menu says: the name of the app the file opens in, or null when the file is not from a provider with a web editor. A Google-native file is kept in Vyre as an export (docx, xlsx or pdf),
 * and the export tells which Google app it came from; the press asks the provider for the exact one.
 */
export function openInLabel(file: { source: string | null; name: string; kind: string; mime?: string }): string | null {
  const provider = file.source;
  if (provider === null) return null;
  if (/dropbox/i.test(provider)) return "Dropbox";
  if (/google/i.test(provider)) {
    if (file.kind !== "google_native") return "Google Drive";
    const mime = file.mime ?? "";
    if (mime.includes("spreadsheetml") || extOf(file.name) === "xlsx") return "Google Sheets";
    if (mime.includes("wordprocessingml") || extOf(file.name) === "docx") return "Google Docs";
    return "Google Slides";
  }
  if (/sharepoint|onedrive|microsoft/i.test(provider)) return OFFICE[extOf(file.name)] ?? (/onedrive/i.test(provider) ? "OneDrive" : "SharePoint");
  return null;
}

export const openInWords = (label: string): string => `Open in ${label}`;

/** The provider's address for a mounted file, or null when there is none for this person (or the file is not from a provider). */
export async function fileLink(call: Call, fileId: string): Promise<FileLink | null> {
  try {
    const out = (await call("mounts.file_link", { fileId })) as { link?: FileLink };
    return out.link ?? null;
  } catch {
    return null;
  }
}

/** Open the file in its provider's editor. Resolves false when there was no address to open (the caller says so). */
export async function openInProvider(call: Call, openUrl: (url: string) => void, fileId: string): Promise<boolean> {
  const link = await fileLink(call, fileId);
  if (!link) return false;
  openUrl(link.webUrl);
  return true;
}
