// Seed recipe for the default Kit (manifest fixtures.seed): the calls that make the main team Space "Northwind" feel lived in. They run through the capability API,
// so the seed also tests the API. The Kit's own install steps (kit.json) run first; these add sample content on top.
export interface SeedStep { cap: string; input: Record<string, unknown> }

export const seed: SeedStep[] = [
  { cap: "records.create", input: { type: "note_board", fields: { title: "Welcome to Northwind", body: "This board is for notes the whole team can see. Ask your assistant to add the next one." }, idempotencyKey: "seed.default.note.welcome" } },
  { cap: "records.create", input: { type: "note_board", fields: { title: "How we work", body: "Decisions go in the channel. Anything that needs a yes goes in Needs you." }, idempotencyKey: "seed.default.note.how" } },
];
