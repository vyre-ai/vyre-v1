# Hour-1 dry run (P-PR_74, ruling 16)

Run on 2026-10-24 23:29 to 2026-10-25 00:38 PKT. First packet of each of the 17 build lanes, 17 real Grok workers (grok-4.7-build) started at once through harness/dispatch.py (`one`, one process per packet), against a copy of the tracker DB (port 7791), on throwaway branches `dryrun/<packet>`. The real tracker packets were not touched. Nothing was merged. Lanes L9b to L9f depend on L9_02 and L9_03, so those were marked done in the copy.

Harness change for the run: `VYRE_BRANCH_PREFIX` env (default `packet`) sets the branch prefix. Nothing else changed.

## Results

| Packet | Lane kind | Grok attempts (s) | CI runs | Wall (min) | Checklist | Verdict | Reason |
|---|---|---|---|---|---|---|---|
| P-L11_01 | perf harness | 1167 | 1 green | 22 | all | accept | Clean, in owned paths, tests ok in CI |
| P-L4_01 | module CRUD (files tree) | 2400 (killed), 960 | red, green | 60 | 5/5 | accept | Sealed to owned paths. handlers/tree.ts is 1358 lines, split it later |
| P-L7_01 | module CRUD (access) | 2159, 921 | red, green | 56 | 7/7 | accept | Roles and check present with perf test |
| P-L1_01 | sync core | 2400 (killed), 1073 | red, green | 68 | 0/7 | send back | Code and both test files green; no evidence on the checklist, submit refused |
| P-L8_01 | module (sites) | 1826, 737 | red, green | 47 | 4/6 | send back | Deploy and domains present; read and lanes-check items not evidenced |
| P-L5_01 | module (mail) | 1854, 606 | red, green | 45 | 3/6 | send back | drafts.ts and connect, draft, sync_now, IDLE are missing; only ingest built |
| P-L6_01 | module (tasks) | 2396, 249 | red, red | 48 | 0/6 | send back | state.property and act tests have no ok line in CI; manifest flip not done |
| P-L7b_01 | module (logs) | 1546, 318 | red, red | 35 | 0/6 | send back | search.test.ts has no ok line in CI (path or 20 s cap); sink ok |
| P-L2_01 | core (turn engine) | 2049, 174 | red, red | 41 | 0/7 | send back | Harness read `route.test.ts` in a checklist sentence as a required file (harness bug); tests otherwise ok. Needs lead read of engine.ts (648 lines) |
| P-L3_01 | core (records write) | 1662, 1157 | red, red | 51 | 0/6 | send back | 3 failing tests. Sealed-value refusal is implemented |
| P-L10_01 | edge (relay client crypto) | 1260, 73 | red, red | 26 | 0/6 | send back | pair.test.js fails twice; crypto code needs a careful author |
| P-L9_01 | UI (theme) | 972, 752 (crashed) | red | 31 | 0/7 | send back | theme.firstframe test fails; second attempt exited 1 with no commit; no screenshots |
| P-L9b_01 | UI (Home) | 1374, 807 | red, red | 41 | 0/5 | send back | Named test apps/app/tests/home-a.test.tsx is a 1-line stub; real tests sit in src; no screenshots |
| P-L9c_01 | UI (Inbox list) | 1151, 433 | red, red | 31 | 0/6 | send back | No pill chips (good). Test missing at the named path; no screenshots, no scroll proof |
| P-L9d_01 | UI (Records table) | 1540, 980 | red, red | 46 | 0/6 | send back | Same path problem; table100k proof absent |
| P-L9e_01 | UI (Files list) | 1570, 762 | red, red | 43 | 0/6 | send back | files-list.test.tsx fails; no screenshots |
| P-L9f_01 | UI (Automations) | 1581, 1107 | red, red | 49 | 0/5 | send back | Trigger "chips" markup may break the no-pill rule; path problem; no screenshots |

Every worker commit is authored by Irfad Imtiaz alone. No attribution lines, no em dashes, no files outside the owned lists (the harness enforces the last one).

## Numbers

- First-pass acceptance (first Grok attempt reviewed as accepted, no fix round): 0 of 17.
- After the one automatic CI-fix round and lead review: accept 3 of 17 (18 percent): L4, L7, L11.
- Send back for evidence or harness fixes only, code looks sound: 5 of 17 (L1, L8, L2, L6, L7b).
- Send back for real defects or missing scope: 9 of 17 (L3, L5, L10 and the six UI packets L9, L9b to L9f).
- Wall time per packet from start to harness result: median 43 min, range 22 to 68 min. Grok run time per attempt: median about 1150 s; two first attempts hit the 2400 s timeout (L1, L4). Whole batch: 68 min.
- 9 of 17 first attempts exited non-zero (timeout or exit 1) but had committed work, so the harness went to CI anyway. Only 5 first attempts exited 0.
- Rework: 17 first pushes plus 15 fix pushes = 32 CI runs in 68 min. 15 of 17 first pushes failed CI.
- Cause of the failed first pushes: a shared screen test, `ui/src/__screens__/batch3.screen.test.tsx`, failed on 5 branches (L3, L4, L5, L7b, L8) at the origin/main base. It is not a Grok defect. It passed on the fix pushes of L4, L5, L7b and L8, so it looks like an affected-test selection flake. Fix it or quarantine it before the build.
- Grok usage: 66 usage rows, 82.3M input tokens (mostly cache reads), 3.27M output tokens. Tracker estimate at list rate $296; the Grok CLI reports about $100 total_cost_usd across the kept attempt logs. No rate limiting seen (`rate_limited` false on all 17).
- Lead review time: about 4 minutes per packet from the diff stat, checklist, CI result, a spec grep and, for UI, the prototype tokens; 17 packets in about 70 minutes of lead time. The deep read of every file was not done for L1, L2, L3, L5 to L8; those verdicts rest on tests, checklist, owned paths and spot checks. Treat "accept" on L4, L7 and L11 as provisional until the real reviewer pass.

## CI with 17 workers (ruling 12)

- 32 runs, 6 jobs per run. Run execution (first job start to last job end): median 59 s, max 92 s. Inside the 5 min budget by a wide margin.
- Job queue wait: median of per-run max 3 s, mean 8 s, worst 35 s. Alert level is 2 min; never reached.
- The 17-push burst did not happen. Grok attempts ended 9 to 68 min apart; the busiest minute held 4 pushes. So this run proves queueing is fine up to about 4 simultaneous pushes on 24 runners and says nothing about 17.
- Model for a true burst: 17 pushes x 6 jobs = 102 jobs, about 20 s each, on 24 runners drains in about 90 s of runner time per runner, so worst queue about 2 to 3 min. P-PR_52 measured 4.5 min on 12 saturated runners, which matches. With second-wave fix pushes the load roughly doubles.

## Recommendation

Grok stays on (well specified, mechanical, test-heavy):
- Module CRUD and adapter packets with a stub contract: L4 files, L7 access, L7b logs, L8 sites, L5 mail ingest, L6 tasks, L11 perf harness.
- Condition: fix the harness first (see below), split any handler over 600 lines, and keep each packet to one handler plus its test.

Move to Sonnet (taste, security, core, UI):
- All UI places: L9, L9b, L9c, L9d, L9e, L9f. Grok cannot take or compare screenshots on this setup, put tests in the wrong place, and the ruling 14 gate (screenshots against the prototype in both skins) was met by none.
- Core: L1 replica and sync, L2 turn engine, L3 records write.
- Crypto and edge: L10 relay client.
- That is 10 of 17 first packets on Sonnet and 7 on Grok (L4, L5, L6, L7, L7b, L8, L11). L5 and L6 are the weaker two; keep them on Grok only with a lead scope check against the checklist.

Harness fixes before the build window (they caused 5 of the 14 red results):
1. Match a checklist "Write and pass <path>" item by the file stem, and ignore `.test.ts` names that only appear inside prose (L2).
2. When the checklist names `apps/app/tests/x.test.tsx` and the worker writes a `.test.ts` next to the source, the dispatcher prompt must say which path is required (L9b to L9f).
3. Auto-check the "gen --check, lanes-check, boundaries, lint" item from the CI result instead of waiting for the worker (L1, L5, L8).
4. Quarantine or fix `batch3.screen.test.tsx`.
5. Do not run a CI-fix attempt when the previous attempt exited non-zero and made no commit (L9 crashed on attempt 2).
6. Raise the Grok timeout to 3000 s for sync and files packets, or split them (L1, L4 hit 2400 s).

Runners: measured need is zero extra, because no more than 4 pushes landed in a minute. For a burst of 17 first pushes plus 15 fix pushes, add 12 temporary runners (24 to 36) on the personal DigitalOcean account for the build window and destroy them after final testing, which holds modeled queue under 2 min. Stagger worker starts by 60 s if you want to avoid paying for them.

## Trace

Event log of the dry run: tracker DB copy at Orgs/Vyre/tracker/dryrun.db (events table), branches `dryrun/P-L*_01` on vyre-ai/vyre-v1, dispatcher logs at Orgs/Vyre/harness/dryrun-logs/. Only 3 of 17 packets reached in_review; none reached done in the copy, because accepted results go to their build packets (ruling 16).
