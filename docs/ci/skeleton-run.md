# CI skeleton run: no-op change

Packet P-PR_61. Measured on `prep/P-PR_61-m` (an empty commit on top of main 02243db), push run
https://github.com/vyre-ai/vyre-v1/actions/runs/40119658160 (conclusion: success, budget job green).

Per ruling 12 the push budget (`ci_push_5m`) measures execution from the first job start. Queue wait is reported separately and alerts at 2 min.

| Measure | Value | Limit |
|---|---|---|
| Queue (run created 18:12:43 to first job start 18:12:46) | 3 s | alert at 2 min |
| Execution (first job start 18:12:46 to last job end 18:13:31) | 45 s | under 90 s (this packet), under 5 min (`ci_push_5m`) |

## Stage table (job wall time, from the run's job start and completion stamps)

| Job | Start | End | Wall | ARCH 10.7 typical |
|---|---|---|---|---|
| golden | 18:12:46 | 18:12:59 | 13 s | affected golden 40 s (nothing affected) |
| contracts | 18:12:46 | 18:13:01 | 15 s | gen --check 15 s |
| select | 18:12:47 | 18:13:01 | 14 s | 5 s |
| fast shards (matrix) | 18:13:01 | 18:13:01 | 0 s | nothing selected for an empty change |
| check (gate) | 18:13:03 | 18:13:14 | 11 s | |
| budget | 18:13:16 | 18:13:31 | 15 s | |

Runner host for the budget job: `vyre-ci-2` (self-hosted fleet, label set from P-PR_60).
`select` is 9 s above the ARCH 10.7 typical of 5 s; it runs in parallel with golden and contracts (ruling 12), so it does not extend the critical path.

## Reading

The critical path is select, then check, then budget: 14 s + 2 s gap + 11 s + 2 s gap + 15 s. A change that selects tests adds the matrix shards (about 25 s each after cache) before check.
