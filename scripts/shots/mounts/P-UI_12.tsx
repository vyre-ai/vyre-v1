// Mount for P-UI_12: the shared Plan over the Northwind My work tasks, in its own frame (no shell). ?view=timeline|board|list|calendar picks the view.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Plan } from "../../../ui/src/Plan/index.tsx";
import type { PlanTask, PlanView } from "../../../ui/src/Plan/index.tsx";

export const title = "Plan";

const P = (name: string): { name: string; kind: "person" } => ({ name, kind: "person" });
const A = (name: string): { name: string; kind: "agent" } => ({ name, kind: "agent" });
// The tasks of the prototype's "Rivera engagement" project (the screen the prototype side of each shot opens), so both sides draw the same data.
const T = (id: string, stage: string, title: string, start: string, end: string, who: ReturnType<typeof P> | ReturnType<typeof A>, status: PlanTask["status"]): PlanTask => ({ id, stage, kind: "task", title, start, end, assigned: who, status, effort: "3h" });
const TASKS: PlanTask[] = [
  T("t1", "Intake", "Send welcome pack", "2026-10-20", "2026-10-23", A("Intake"), "done"),
  T("t2", "Drafting", "Send the engagement letter for signature", "2026-10-23", "2026-10-26", A("Docs"), "todo"),
  T("t3", "Drafting", "Request ID document", "2026-10-23", "2026-10-26", A("Intake"), "todo"),
  T("t4", "Drafting", "Send engagement letter", "2026-10-24", "2026-10-27", A("Docs"), "doing"),
  T("t5", "In review", "Chase Elena's ID scan before Tuesday", "2026-10-23", "2026-10-26", A("Intake"), "todo"),
  T("t6", "In review", "Run the conflict check", "2026-10-23", "2026-10-26", P("Lena Ortiz"), "doing"),
];
const STAGES = [{ id: "Intake", name: "Intake" }, { id: "Drafting", name: "Drafting" }, { id: "In review", name: "In review" }, { id: "Delivered", name: "Delivered" }];
const PEOPLE = [P("Maya Chen"), P("Omar Haddad"), P("Lena Ortiz"), P("Sam Patel"), A("Intake"), A("Billing"), A("Research"), A("Docs"), A("Scout")];
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
