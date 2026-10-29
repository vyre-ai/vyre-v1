# Release practice run (P-L11_14)

Throwaway tags, no real release: `v0.0.0-dryrun.1` (main at ceb4ea72) and `v0.0.0-dryrun.2` (build/P-L11_14 with the release.yml select fix). release.yml runs on a `v*` tag; nothing in it publishes or signs, so the tags had no outward effect. Both tags were deleted after the runs.

## Runs

| Run | Tag | Wall | Result | Why red |
|---|---|---|---|---|
| 40258187870 | dryrun.1 | 3m01s | failure | `host/tests/live.l7b.test.ts` (red on main until #576), `fixtures/seed/small` and `fixtures/seed/perf` over the 30 s file watchdog on a fast shard |
| 40259223474 | dryrun.2 | 4m18s | failure | `kernel/tests/gsia.seal.test.ts` "a short key is refused" (an assertion, true !== false), `golden/harness.test.ts` over the 30 s watchdog |

In both runs `live` and `deploy` were skipped because `live` needs the suite green. So the tag-to-live path through `live` and `deploy` has not run; only select, suite shards, the side workflows and budget-tag have.

## Stage times, dryrun.2 (job wall time)

| Stage | Time |
|---|---|
| select | 15 s |
| client, kits, images, heavy, security, desktop, native | 14 s to 18 s each (all are placeholders that echo) |
| suite, 8 fast shards | 76 s to 216 s |
| suite, 3 slow jobs | 36 s to 92 s |
| budget-tag | 17 s |
| live, deploy | skipped (suite red) |
| Whole run | 4m18s, inside the 25 minute budget with room; the budget job passed |

The budget is not at risk from these numbers, but they are measured on placeholder stages. When client, kits, images, heavy, security and deploy do real work the total grows; measure again then.

## What was found and fixed

- release.yml selected the suite with `ci-select.ts "" --matrix` and no `--no-perf`, so the tag ran perf files on loaded shards (seed perf test failed the watchdog). Fixed on this branch: same select as main.yml (`--max 8 --no-perf`) and an empty matrix is now an error.
- live.l7b was red on main (fixed by #576). Not caused by the release.

## Found, not fixed (not in this packet's files)

1. `kernel/tests/gsia.seal.test.ts:102` "a short key is refused" fails on the tag commit. Someone owning kernel/ must look; it blocks a real tag.
2. `golden/harness.test.ts` and `fixtures/seed/small/small.seed.test.ts` take over 30 s on a loaded fast shard (32 s). They belong on the slow list (ruling 52, scripts/slow-check.ts), or the tag must run golden through `golden.yml` only.
3. This historical run predates the current release workflow. `release.yml` now has lineage, signing, publishing and smoke stages, and `desktop.yml` builds the ad-hoc-signed macOS DMG used by the release payload. The remaining gaps are a real tagged release execution, real deploy, and mobile artifacts; see docs/release/runbook.md.
4. The historical run predated the now-configured GitHub Environment `release`, its protected signing secret, required reviewer, and online signing/build runners. A real release has not run yet.

## Not run, by instruction

Signing (needs the Environment and its key), publishing to a GitHub Release, deploy and the post-deploy smoke. The Linux node, app export, Chrome extension and installer builds are not release.yml jobs yet, so none ran.
