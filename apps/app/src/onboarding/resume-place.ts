// Where the Finish setup entry is drawn: in the foot of the Chats sidebar while that sidebar is on screen (design 13 Nov, 2.7: the title bar belongs to search and notices), else in the title bar as before.
import { useSyncExternalStore } from "react";

let inFoot = 0;
const listeners = new Set<() => void>();
const tell = (): void => {
  for (const f of [...listeners]) f();
};
/** The Chats sidebar says it draws the entry for as long as it is mounted; returns the way back. */
export function claimResumeFoot(): () => void {
  inFoot++;
  tell();
  return () => {
    inFoot--;
    tell();
  };
}
export const resumeInFoot = (): boolean => inFoot > 0;
export function useResumeInFoot(): boolean {
  return useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), resumeInFoot, resumeInFoot);
}
