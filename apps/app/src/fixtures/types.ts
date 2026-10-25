// The shape of the seed fixtures: the prototype's three sample Spaces (Northwind, Harbor Studio, Personal) as plain data, so every mount draws the same people, agents,
// channels, Needs you items and chats, and a person's id is always shown as the person's name.

export type SpaceKey = "northwind" | "harbor" | "personal";

export interface FixtureSpace {
  key: SpaceKey;
  /** The prototype's short id (nw, hb, me). */
  protoId: string;
  name: string;
  address: string;
  team: boolean;
  role?: "Owner" | "Member";
  unread?: number;
}

export interface FixturePerson {
  id: string;
  name: string;
  role: "Owner" | "Admin" | "Member";
  online?: boolean;
}

export interface FixtureAgent {
  id: string;
  name: string;
  role: string;
  pinned: boolean;
  model: "opus" | "sonnet" | "gpt5" | "kimi";
}

export interface FixtureChannel {
  id: string;
  name: string;
  topic: string;
  /** Person ids. */
  members: readonly string[];
  /** Agent ids. */
  agents: readonly string[];
  lead?: string;
  project?: boolean;
  private?: boolean;
  unread?: boolean;
  mentions?: number;
}

export interface FixtureNeed {
  id: string;
  /** The agent id that asks. */
  agent: string;
  kind: "Approve" | "Review" | "Blocked";
  title: string;
  sub: string;
  chat: string;
  at: string;
}

export interface FixtureChat {
  id: string;
  title: string;
  /** Agent id for a chat with an agent, person id for a direct message. */
  with: string;
  at: string;
  /** 0 today, 1 yesterday, 2 earlier. */
  day: 0 | 1 | 2;
  unread?: boolean;
  starred?: boolean;
  online?: boolean;
}

export interface SpaceFixture {
  space: FixtureSpace;
  /** The signed-in person in this Space. */
  me: string;
  people: readonly FixturePerson[];
  agents: readonly FixtureAgent[];
  channels: readonly FixtureChannel[];
  needs: readonly FixtureNeed[];
  chats: readonly FixtureChat[];
}
