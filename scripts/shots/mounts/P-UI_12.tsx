// Mount for P-UI_12: the shared Plan over the Northwind My work tasks, in its own frame (no shell). ?view=timeline|board|list|calendar picks the view.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Plan } from "../../../ui/src/Plan/index.tsx";
import type { PlanTask, PlanView } from "../../../ui/src/Plan/index.tsx";

export const title = "Plan";

const P = (name: string): { name: string; kind: "person" } => ({ name, kind: "person" });
const A = (name: string): { name: string; kind: "agent" } => ({ name, kind: "agent" });
const TASKS: PlanTask[] = [
  { id: "t1", stage: "pruitt", kind: "task", title: "Send the retainer reminder to Marcus Pruitt", start: "2026-10-20", end: "2026-10-22", status: "doing", assigned: P("Irfad Imtiaz") },
  { id: "t2", stage: "pruitt", kind: "task", title: "Review the Pruitt intake form", start: "2026-10-23", end: "2026-10-26", status: "review", assigned: A("Intake"), deps: ["t1"] },
  { id: "t3", stage: "pruitt", kind: "task", title: "Prepare the consult folder", start: "2026-10-27", end: "2026-10-29", assigned: P("Omar Haddad"), deps: ["t2"] },
  { id: "m1", stage: "pruitt", kind: "milestone", title: "Consult", start: "2026-10-30", deps: ["t3"], fixed: true },
  { id: "t4", stage: "atp", kind: "task", title: "Review the Harlow & Price worksheet", start: "2026-10-22", end: "2026-10-23", status: "blocked", assigned: A("Research") },
  { id: "t5", stage: "atp", kind: "task", title: "Quarterly ATP review", start: "2026-10-26", end: "2026-10-31", assigned: P("Irfad Imtiaz"), deps: ["t4"] },
  { id: "t6", stage: "rivera", kind: "task", title: "Approve the engagement letter", start: "2026-10-24", end: "2026-10-24", status: "approval", assigned: A("Docs") },
  { id: "t7", stage: "rivera", kind: "task", title: "Call Elena about the fee waiver", start: "2026-10-24", end: "2026-10-25", status: "doing", assigned: P("Irfad Imtiaz") },
];
const STAGES = [{ id: "pruitt", name: "Pruitt engagement" }, { id: "atp", name: "ATP · Harlow & Price" }, { id: "rivera", name: "Rivera matter" }];
const PEOPLE = [P("Irfad Imtiaz"), P("Maya Chen"), P("Omar Haddad"), A("Intake"), A("Docs"), A("Research")];
const VIEWS: readonly PlanView[] = ["timeline", "board", "list", "calendar"];

export default function Mount(): ReactNode {
  const [view, setView] = useState<PlanView>("timeline");
  useEffect(() => {
    const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("view");
    const v = VIEWS.find((x) => x === q);
    if (v) setView(v);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string, padding: 24 }}>
      <Plan key={view} today="2026-10-24" stages={STAGES} tasks={TASKS} people={PEOPLE} view={view} height={520} onOpenTask={() => undefined} />
    </View>
  );
}
