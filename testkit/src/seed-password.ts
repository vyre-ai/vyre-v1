// The one password every seeded person has in test Spaces (fixtures/seed). It exists only for tests: a seeded Space is built from a recipe, never from a real install, and the verifier it
// produces uses the lowest Argon2id cost the identity module accepts. Nothing that ships imports this file.
export const SEED_TEST_PASSWORD = "seed-test-password-1";
