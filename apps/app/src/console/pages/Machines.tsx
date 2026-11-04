// Console > Machines: every machine of the Space as one list with a page each, the one place to add a server, and, under the list, the agent computers that sit on them. The page is the shared
// Machines component (apps/app/src/machines); the Console adds the agent computers and the way into logs, updates and backups.
import type { ReactElement } from "react";
import { MachinesView } from "../../machines/MachinesView.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { AgentComputers } from "./Agents.tsx";

export function MachinesPage({ initialId, startAdd }: { initialId?: string; startAdd?: boolean }): ReactElement {
  const data = useConsoleData();
  return (
    <MachinesView
      call={data.call as never} scope="space" who={(id) => data.name(id)} initialId={initialId ?? null} {...(startAdd ? { startAdd } : {})}
      onOpen={(id) => data.nav.openPage("machines", id ? { machineId: id } : {})} goto={(page) => data.nav.openPage(page)}
      extra={<AgentComputers />}
    />
  );
}
