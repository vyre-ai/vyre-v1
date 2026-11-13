// The address links to things in this Space are made from. The app sets it when a session opens (apps/app/src/share/rows.ts setLinkOrigin); ui pieces that copy a link (the artifact card in a chat) read it here
// instead of the page's own origin, which is tauri://localhost inside the desktop app. "" means the Space has no public address anyone else could open.
let origin = "";
let onNone: () => void = () => undefined;

export const setSpaceLinkOrigin = (o: string, none?: () => void): void => {
  origin = o;
  if (none) onNone = none;
};
export const spaceLinkOrigin = (): string => origin;
/** Say there is no link to give (the app shows its words). */
export const noLinkToGive = (): void => onNone();
