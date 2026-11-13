// How links to things in this Space are made and copied. The app sets it when a session opens (apps/app/src/share/rows.ts setLinkOrigin); ui pieces that copy a link (the artifact card in a chat) call it instead
// of reading the page's own origin, which is tauri://localhost inside the desktop app.
let origin = "";
let artifactLink: (id: string) => string = () => "";
let copyLink: (link: string) => void = () => undefined;

export const setSpaceLinkTools = (t: { origin: string; artifactLink: (id: string) => string; copy: (link: string) => void }): void => {
  origin = t.origin;
  artifactLink = t.artifactLink;
  copyLink = t.copy;
};
/** The Space's public address for building an address, or "" when it has none. */
export const spaceLinkOrigin = (): string => origin;
/** The link to an artifact, as the app makes it ("" when there is nothing that would open). */
export const artifactLinkFor = (id: string): string => artifactLink(id);
/** Copy a link as the app does: on the clipboard, or in words why there is none to give. */
export const copyLinkAsApp = (link: string): void => copyLink(link);
