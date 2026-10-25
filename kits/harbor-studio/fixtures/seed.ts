// Seed recipe for the Harbor Studio Kit (manifest fixtures.seed): the third seeded Space, a design studio with its own Kit, skin and agents.
// The Kit's install steps (kit.json) run first; these add commissions so a Space switch from Northwind visibly swaps the data, words and rail.
export interface SeedStep { cap: string; input: Record<string, unknown> }

export const seed: SeedStep[] = [
  { cap: "records.create", input: { type: "commission", fields: { title: "Quay Street identity", client: "Quay Street Roasters", status: "concept" }, idempotencyKey: "seed.harbor.commission.quay" } },
  { cap: "records.create", input: { type: "commission", fields: { title: "Tidal Press catalogue", client: "Tidal Press", status: "brief" }, idempotencyKey: "seed.harbor.commission.tidal" } },
  { cap: "records.create", input: { type: "commission", fields: { title: "Lantern Hotel signage", client: "Lantern Hotel", status: "review" }, idempotencyKey: "seed.harbor.commission.lantern" } },
];
