// ui/AskButton types (owner requirement: Ask is an agent dropdown everywhere, never one hardcoded agent; spec 3.0 mobile, 2.5).
// One shared control for every place header, record page, task, email builder, forms and sites.

/** An agent the person can ask. `assistant` marks the Space assistant (always listed, the fallback). */
export interface AskAgent {
  id: string;
  name: string;
  role?: string;
  assistant?: boolean;
}

/** The viewer's level for the item. An agent acting for you gets the intersection of its access and yours. */
export type AskAccess = "view" | "use" | "edit" | "manage";

/** What the ask is about. The new thread carries it as a chip ("About id-scan.png"). */
export interface AskContext {
  kind: string;
  id: string;
  title: string;
  access: AskAccess;
}

/** chat: open a new thread about the item. do: the agent takes the task and works on it. */
export type AskMode = "chat" | "do";

/** Key value storage for the remembered picks. localStorage on web, memory elsewhere. */
export interface AskStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface AskButtonProps {
  /** Where the control sits: "files", "records", "task", "email", "forms", "sites". The pick is remembered per place. */
  place: string;
  context: AskContext;
  /** Every agent this person can ask, assistant included. */
  agents: readonly AskAgent[];
  /** Id of the agent tied to this item (an invoice's Billing, a file's owner agent, whoever last worked on the record). */
  suggested?: string;
  /** ["chat"] (default): the main press starts a thread. ["do", "chat"]: the main press offers Do it or Chat about it. */
  modes?: readonly AskMode[];
  /** Starts the new thread with the chosen agent about the item. */
  onAsk: (agent: AskAgent, mode: AskMode, context: AskContext) => void;
  /** The person changed the agent. */
  onPick?: (agent: AskAgent) => void;
  /** Right-click, Open the agent's page. */
  onOpenAgent?: (agent: AskAgent) => void;
  /** Avatar override. Receives the agent and a pixel size. */
  renderFace?: (agent: AskAgent, size: number) => import("react").ReactNode;
  /** Icon only (a narrow header). The label stays as the accessible name. */
  compact?: boolean;
  /** Where picks are remembered. Defaults to the browser's localStorage, then memory. */
  storage?: AskStorage;
  /** Opens the picker as soon as it mounts (screenshots, tests). */
  startOpen?: boolean;
  testID?: string;
}

export interface PickerEntry {
  /** "head" is a section title, "agent" a selectable row. */
  kind: "head" | "agent";
  label: string;
  agent?: AskAgent;
  /** The quiet line under the name: the agent's role, or why it is listed. */
  note?: string;
  current?: boolean;
}
