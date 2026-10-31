// The Mount card (rc.8 live folders): an agent that needs a folder it cannot see asks with the structured question tool, and options whose keys start with "mount:" are the sources it offers
// ("mount:google_drive", "mount:onedrive", "mount:sharepoint", "mount:github"). The chat draws that question as a card: pick a source, connect and browse in the mount sheet, mount,
// and the new folder is shared with the chat's agents and the question is answered so the agent carries on.
export interface SourceOffer { source: string; label: string; brand: string | undefined }

const SOURCES: Record<string, { label: string; brand?: string }> = {
  google_drive: { label: "Google Drive", brand: "gdrive" }, onedrive: { label: "OneDrive", brand: "onedrive" }, sharepoint: { label: "SharePoint", brand: "sharepoint" },
  github: { label: "GitHub", brand: "github" },
};

/** The sources a question offers, or null when it is an ordinary question (any option that is not a mount source makes it one). */
export function mountOffers(options: readonly { id: string; label: string }[]): SourceOffer[] | null {
  if (options.length === 0 || !options.every((o) => o.id.startsWith("mount:") && SOURCES[o.id.slice(6)] !== undefined)) return null;
  return options.map((o) => { const s = SOURCES[o.id.slice(6)] as { label: string; brand?: string }; return { source: o.id.slice(6), label: s.label, brand: s.brand }; });
}

/** What goes back to the agent when the folder is mounted: where it is and that it is shared. */
export const mountedAnswer = (name: string, folderId: string): string => `Mounted "${name}" (folder ${folderId}). It is shared with you: list and read it with the file tools.`;
