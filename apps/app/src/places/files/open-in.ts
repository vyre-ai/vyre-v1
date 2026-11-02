// "Open in Google Docs / Word / Excel / Dropbox" for a file that comes from a mounted folder (live folders L3). The provider's own editor opens the same file: Vyre shows its preview and the provider
// edits it. The address comes from the provider (mounts.file_link) at the moment of the press, so it is the file's current one and a person who cannot open the file there gets no link; the words on the
// menu item are worked out from what the row already knows (the provider's name, the file's name and kind), so the menu opens at once.

import { GOOGLE_APP_NAME, googleAppOf } from "./google.ts";

/** What mounts.file_link answers for a file that has a provider address. */
export interface FileLink { openIn: string; webUrl: string; type: string; edit: readonly string[] }

type Call = (cap: string, input: unknown) => Promise<unknown>;

const OFFICE: Readonly<Record<string, string>> = { doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", xlsm: "Excel", ppt: "PowerPoint", pptx: "PowerPoint" };

const extOf = (name: string): string => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/**
 * What a row's menu says: the name of the app the file opens in, or null when the file is not from a provider with a web editor. A Google-native file keeps Google's own type, which names
 * its app (a Doc opens in Google Docs); the press asks the provider for the exact address.
 */
export function openInLabel(file: { source: string | null; name: string; kind: string; mime?: string }): string | null {
  const provider = file.source;
  if (provider === null) return null;
  if (/dropbox/i.test(provider)) return "Dropbox";
  if (/google/i.test(provider)) {
    const app = googleAppOf(file);
    return app === null ? "Google Drive" : GOOGLE_APP_NAME[app];
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
