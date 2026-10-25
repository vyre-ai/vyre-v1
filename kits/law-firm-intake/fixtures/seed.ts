// Seed recipe for the law-firm-intake Kit (manifest fixtures.seed): a few leads at different stages, so the pipeline and the intake Journey have something to show.
// They run through the capability API after the Kit's own install steps (kit.json), so the seed also tests the API.
export interface SeedStep { cap: string; input: Record<string, unknown> }

export const seed: SeedStep[] = [
  { cap: "records.create", input: { type: "lead", fields: { name: "Maria Alvarez", email: "maria@example.com", phone: "+15555550101", stage: "new", practiceArea: "Family" }, idempotencyKey: "seed.law-firm-intake.lead.maria" } },
  { cap: "records.create", input: { type: "lead", fields: { name: "Chen Wei", email: "chen@example.com", phone: "+15555550102", stage: "consult", practiceArea: "Employment" }, idempotencyKey: "seed.law-firm-intake.lead.chen" } },
  { cap: "records.create", input: { type: "lead", fields: { name: "Ola Bakare", email: "ola@example.com", stage: "retained", practiceArea: "Immigration" }, idempotencyKey: "seed.law-firm-intake.lead.ola" } },
  { cap: "records.create", input: { type: "matter", fields: { title: "Bakare v. Employer (visa extension)", status: "open" }, idempotencyKey: "seed.law-firm-intake.matter.bakare" } },
];
