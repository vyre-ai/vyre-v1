// The seed fixtures every mount reads (Northwind, Harbor Studio, Personal; the data is read from the prototype): the prototype's Northwind, Harbor Studio and Personal Spaces, and the resolvers that turn an id into the name a person sees.
// A raw id (usr_maya, agt_scheduler) is never shown: nameOf falls back to a readable word, never to the id.

import { harbor } from "./harbor.ts";
import { northwind } from "./northwind.ts";
import { personal } from "./personal.ts";
import type { SpaceFixture, SpaceKey } from "./types.ts";

export type { FixtureAgent, FixtureChannel, FixtureChat, FixtureNeed, FixturePerson, FixtureSpace, SpaceFixture, SpaceKey } from "./types.ts";
export { harbor, northwind, personal };

export const SPACE_KEYS: readonly SpaceKey[] = ["northwind", "harbor", "personal"];

const BY_KEY: Readonly<Record<SpaceKey, SpaceFixture>> = { northwind, harbor, personal };

/** The fixture for a Space key. */
export function fixtureFor(key: SpaceKey): SpaceFixture {
  return BY_KEY[key];
}

/** Every id in the Space with its display name: people and agents, the channels as #name. The caller's extras (automations, keys, services) are added after and win. */
export function namesFor(key: SpaceKey, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const f = BY_KEY[key];
  const out: Record<string, string> = {};
  for (const p of f.people) out[p.id] = p.name;
  for (const a of f.agents) out[a.id] = a.name;
  for (const c of f.channels) out[c.id] = `#${c.name}`;
  return { ...out, ...extra };
}

/** Only the people, id to name (the shape the Records and Files samples take as `people`). Agents are included when asked for by id. */
export function peopleFor(key: SpaceKey, ids: readonly string[]): Record<string, string> {
  const all = namesFor(key);
  const out: Record<string, string> = {};
  for (const id of ids) {
    const n = all[id];
    if (n === undefined) throw new Error(`fixtures: ${id} is not in the ${key} Space`);
    out[id] = n;
  }
  return out;
}

/** The name to show for an id: the Space's name for it, else a plain word for the kind of thing, never the id. */
export function nameOf(key: SpaceKey, id: string): string {
  const n = namesFor(key)[id];
  if (n !== undefined) return n;
  if (id.startsWith("usr_")) return "Someone";
  if (id.startsWith("agt_")) return "An agent";
  return "Unknown";
}

/** The signed-in person's name in the Space. */
export function meName(key: SpaceKey): string {
  return nameOf(key, BY_KEY[key].me);
}
