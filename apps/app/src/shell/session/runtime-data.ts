// What the signed-in shell hands every place: the screens, one capability call, the connection, the people, the clock. (It lived with the Home place until that went; Chats is the first screen now.)
import type { LiveQuery, ScreenHooks } from "../../../../../client/src/index.ts";

export type Kind = "person" | "agent" | "group" | "role" | "automation";
export interface Principal {
  id: string; name: string; kind: Kind; /** The sign-in name this person chose, when this device knows it (it is never read from the Space). */ username?: string;
  /** An agent's person. */ owner?: string;
  /** Someone else's agent this person may not open or @mention (their assistant, an outside agent they connected): named as its person, "Irfad Imtiaz (Agent)", never offered. */ private?: boolean;
  /** A private agent's own name, for owners and admins only (Console audit details). */ agentName?: string;
  /** A person who holds only the Guest role: they see what is shared with them. */ guest?: boolean;
  /** An agent this person may not use that is not someone's private one (a Space agent kept from them): named as it is, never offered. */ hidden?: boolean;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface RuntimeBase {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** Everyone the face menu and the names read from: people, agents, groups, roles. */
  principals: LiveQuery<Principal[]>;
  /** Record titles for the chip on a task, by record id. */
  recordTitle(recordId: string): string | undefined;
  me: Principal;
  clock(): { now: number; offsetMin: number };
}
