// Console > Computers > Agent computers: the agent computers of the Space, as their own tab. The list and each computer's page are the AgentComputers component (Agents.tsx).
import type { ReactElement } from "react";
import { AgentComputers } from "./Agents.tsx";

export function AgentComputersPage(): ReactElement {
  return <AgentComputers />;
}
