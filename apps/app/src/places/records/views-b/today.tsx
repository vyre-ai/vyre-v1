// The day the calendar and the timeline call today. The shell leaves it unset (the real clock); tests and screenshots set it so the pictures do not change from day to day.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

const Ctx = createContext<number | null>(null);

export function TodayProvider({ value, children }: { value: number; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToday(): number {
  return useContext(Ctx) ?? Date.now();
}
