// What Home sections B need from the shell beyond the sections-a data: which kind of Space this is, the assistant, whether an AI account and a calendar are connected,
// and where the checklist and quick-start buttons lead. The shell fills this in; the screenshot mounts and the tests pass their own.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export type GoTarget = "ai" | "photo_and_title" | "connect_mailbox_and_calendar" | "meet_assistant" | "open_first_project" | "import" | "new_project" | "new_record" | "upload" | "team_space";

export interface HomeBExtras {
  space: { kind: "team" | "personal"; name: string };
  assistant: { id: string; name: string };
  /** Without an account the assistant is locked: the Ask box shows the connect line and "Meet your assistant" waits. */
  aiConnected: boolean;
  /** A Personal Space draws Today only when a calendar is connected on this computer. */
  calendarConnected: boolean;
  /** One door for every button on the checklist and the quick-start row. */
  go(target: GoTarget): void;
  openUrl(url: string): void;
}

const Ctx = createContext<HomeBExtras | null>(null);

export function HomeBProvider({ value, children }: { value: HomeBExtras; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExtras(): HomeBExtras {
  const v = useContext(Ctx);
  if (!v) throw new Error("Home sections B need a HomeBProvider above them");
  return v;
}

export const isPersonal = (x: HomeBExtras): boolean => x.space.kind === "personal";
