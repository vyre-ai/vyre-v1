# Sync spike A (S1, S2) report

Numbers come from the CI run linked on P-PR_45 (self-hosted v1 runner, Node 24). Budgets are acceptance, not targets.

| Metric | Result | Budget |
|---|---|---|
| Snapshot, 100,000 rows (400k fields) | see METRIC s1.snapshot_100k in the run log (5.8 s on the first run) | under 10 s |
| Remote edit propagation, HTTP + SSE hint | see METRIC s1.edit_propagation_http (p50 8 ms, p99 13 ms first run) | under 500 ms |
| Local write p99 | see METRIC s1.local_write (p99 1.0 ms first run) | under 10 ms |
| Revocation property test | 8 seeds x 150 steps, replica equals fresh filtered snapshot | all equal |
