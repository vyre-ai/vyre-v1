// What the Finish setup entry hands to the screens that show it in place: the phone's You page reads handled, total and open; the desktop title bar draws `pill`, the entry itself.
// It lives apart from ResumeChip so the title bar can read it without importing the shell it sits in.
import { createContext, useContext } from "react";
import type { ReactElement } from "react";

/** Unfinished setup for screens that show it in place: handled of total, how to reopen it, and the ready-made pill the title bar draws. Null when setup is done or open. */
export interface Resume { handled: number; total: number; open(): void; pill: ReactElement | null }
export const ResumeContext = createContext<Resume | null>(null);
export const useResume = (): Resume | null => useContext(ResumeContext);
