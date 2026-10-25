// Seed recipe for the estate-planning Kit (manifest fixtures.seed): two client plans at different stages. The sealed Tax ID is never seeded.
// They run through the capability API after the Kit's own install steps (kit.json), so the seed also tests the API.
export interface SeedStep { cap: string; input: Record<string, unknown> }

export const seed: SeedStep[] = [
  { cap: "records.create", input: { type: "client_plan", fields: { client: "Harold and June Whitfield", stage: "drafting", trustName: "Whitfield Family Trust" }, idempotencyKey: "seed.estate-planning.plan.whitfield" } },
  { cap: "records.create", input: { type: "client_plan", fields: { client: "Priya Raman", stage: "intake" }, idempotencyKey: "seed.estate-planning.plan.raman" } },
];
