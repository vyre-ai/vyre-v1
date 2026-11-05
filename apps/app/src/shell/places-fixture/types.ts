// The types the seeded replica of the place tests reads (shell/places.test.tsx): the shapes of the capability answers a first screen is drawn from. It lived with the Home place, which is gone.
import type { CapMap } from "../../../../../generated/types.ts";
import type { RuntimeBase } from "../session/runtime-data.ts";

export type NeedsItem = CapMap["tasks.needs_you"]["out"]["items"][number];
export type Task = CapMap["tasks.my_work"]["out"]["tasks"][number];
export type RiskProject = CapMap["home.at_risk"]["out"]["projects"][number];
export type Digest = NonNullable<CapMap["home.digest"]["out"]["digest"]>;
export type Routine = CapMap["home.routines_today"]["out"]["routines"][number];
export type Ref = Task["assigned"];
export type CalEvent = CapMap["calendar.list_events"]["out"]["events"][number];
export type Star = CapMap["stars.list"]["out"]["stars"][number];
export type TerminalRow = CapMap["terminal.status"]["out"]["rows"][number];
export const TODAY_SCREEN = "home.today-starred-ask";

export interface HomeNav {
  openTask(taskId: string): void;
  openRecord(recordId: string): void;
  openRun(runId: string): void;
  openNeedsYou(taskId?: string): void;
  openMyWork(): void;
  openActivity(): void;
  openAgent(agentId: string): void;
  openSubject(subject: { type: string; id: string }): void;
  openInbox?(which: "unread" | "match"): void;
}
export interface HomeData extends RuntimeBase { nav: HomeNav }

export type GoTarget = "ai" | "photo_and_title" | "connect_mailbox_and_calendar" | "meet_assistant" | "open_first_project" | "import" | "new_project" | "new_record" | "upload" | "team_space";
export interface HomeBExtras {
  space: { kind: "team" | "personal"; name: string };
  assistant: { id: string; name: string };
  aiConnected: boolean;
  calendarConnected: boolean;
  go(target: GoTarget): void;
  openUrl(url: string): void;
}
