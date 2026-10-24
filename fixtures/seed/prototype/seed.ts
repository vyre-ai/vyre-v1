// VyreSeed (prototype vyre-v1.html, the same people, clients and agents as tools/gen/seed/spaces.json).
// Ids in the seeded Space are the v1 forms of those ids: usr_<person>, agt_<agent name>, rec_<client>, rec_co<client> for the company.
// Northwind and Harbor Studio are Team Spaces. Personal is the owner plus Assistant (spec 2.1: members need a Team Space).

export const SPACE_KEYS = ["northwind", "harbor", "personal"] as const;
export type SpaceKey = (typeof SPACE_KEYS)[number];

export interface SeedPerson { id: string; name: string; role: "owner" | "admin" | "member"; email: string }
export interface SeedClient { id: string; name: string; org: string; email: string; phone: string }
export interface SeedSpace {
  key: SpaceKey;
  spaceId: string;
  name: string;
  domain: string;
  kind: "team" | "personal";
  people: readonly SeedPerson[];
  clients: readonly SeedClient[];
  agents: readonly string[];
}

export const personId = (id: string): string => `usr_${id}`;
export const agentId = (name: string): string => `agt_${name.toLowerCase()}`;
export const clientId = (id: string): string => `rec_${id}`;
export const companyId = (id: string): string => `rec_co${id}`;

export const VYRE_SEED = {
  northwind: {
    key: "northwind", spaceId: "spc_northwind", name: "Northwind", domain: "northwind.example", kind: "team",
    people: [
      { id: "irfad", name: "Irfad Imtiaz", role: "owner", email: "irfad@northwind.example" },
      { id: "maya", name: "Maya Chen", role: "admin", email: "maya@northwind.example" },
      { id: "omar", name: "Omar Haddad", role: "member", email: "omar@northwind.example" },
      { id: "lena", name: "Lena Ortiz", role: "member", email: "lena@northwind.example" },
      { id: "sam", name: "Sam Patel", role: "member", email: "sam@northwind.example" },
      { id: "dana", name: "Dana Whitfield", role: "member", email: "dana@northwind.example" },
    ],
    clients: [
      { id: "elena", name: "Elena Rivera", org: "Rivera Holdings", email: "elena@riveraholdings.example", phone: "+1 415 555 0161" },
      { id: "priya", name: "Priya Nair", org: "Nair Studio", email: "priya@nairstudio.example", phone: "+1 646 555 0119" },
      { id: "marcus", name: "Marcus Pruitt", org: "Pruitt & Co.", email: "marcus@pruittco.example", phone: "+1 212 555 0148" },
      { id: "webb", name: "Marcus Webb", org: "Webb Advisory", email: "marcus@webbadvisory.example", phone: "+1 312 555 0127" },
    ],
    agents: ["Assistant", "Intake", "Billing", "Research", "Docs"],
  },
  harbor: {
    key: "harbor", spaceId: "spc_harbor", name: "Harbor Studio", domain: "harborstudio.example", kind: "team",
    people: [
      { id: "ines", name: "Ines Costa", role: "owner", email: "ines@harborstudio.example" },
      { id: "theo", name: "Theo Lindqvist", role: "admin", email: "theo@harborstudio.example" },
      { id: "june", name: "June Okafor", role: "member", email: "june@harborstudio.example" },
    ],
    clients: [
      { id: "kai", name: "Kai Moreno", org: "Moreno Ceramics", email: "kai@morenoceramics.example", phone: "+1 503 555 0172" },
      { id: "ruth", name: "Ruth Abel", org: "Abel & Daughters", email: "ruth@abeldaughters.example", phone: "+1 971 555 0136" },
    ],
    agents: ["Assistant", "Scheduler", "Proofer"],
  },
  personal: {
    key: "personal", spaceId: "spc_personal", name: "Personal", domain: "", kind: "personal",
    people: [{ id: "irfad", name: "Irfad Imtiaz", role: "owner", email: "irfadimtiaz7@gmail.com" }],
    clients: [],
    agents: ["Assistant"],
  },
} satisfies Record<SpaceKey, SeedSpace>;

export interface SeedIds { people: string[]; agents: string[]; clients: string[]; companies: string[] }

/** The id list VyreSeed becomes once it is in a Space. Same order as the prototype. */
export function expectedIds(key: SpaceKey): SeedIds {
  const s = VYRE_SEED[key];
  return {
    people: s.people.map((p) => personId(p.id)),
    agents: s.agents.map((a) => agentId(a)),
    clients: s.clients.map((c) => clientId(c.id)),
    companies: s.clients.map((c) => companyId(c.id)),
  };
}
