# Seeded Spaces

`core` is frozen (F6): 6 people with every role, 3 groups, 2 agents, one record type, one channel, a three level folder tree. It is a list of events (core/recipe.ts) folded into the kernel's access projection (core/access.ts), so it needs no module code.
`small` and `perf` are skeletons: the core plus every `modules/*/fixtures/seed.ts`, found by glob.

Template cache: the seed is built once into a database file named by the hash of its sources plus `generated/hash.txt`; a test copies the file and opens it (`bootCore()`, under 100 ms on a hit).
Cache directory: `VYRE_SEED_CACHE`, else `/var/lib/ci-run/seed-cache-v1`, else the OS temp dir. Edit a recipe file or regenerate the registry and the key changes, so a stale template is never used.
Only the lead edits core/recipe.ts; the shape hash in core.seed.test.ts says so.
