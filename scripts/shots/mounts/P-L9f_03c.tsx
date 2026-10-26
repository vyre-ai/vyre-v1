// Mount for P-L9f_03c: the Journey designer finish (task states, On leaving, the Journey types tree in the sidebar, Fields tab) and the Alerts tab without the explaining line under the
// escalation chain. ?view=journey (default) shows Client onboarding with states set; ?view=alerts shows New lead follow-up on its Alerts tab. Both reuse the earlier mounts.
import type { ReactNode } from "react";
import Alerts from "./P-L9f_03.tsx";
import Detail from "./P-L9f_01c.tsx";

export const title = "Automations and Journey designer, finished";

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
  return q.get("view") === "alerts" ? <Alerts /> : <Detail />;
}
