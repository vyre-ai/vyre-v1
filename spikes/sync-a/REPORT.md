# Sync spike A (S1, S2) report

Source: CI spike run https://github.com/vyre-ai/vyre-v1/actions/runs/40107940139 (self-hosted v1 runner, Node 24). Budgets are acceptance, not targets.

| Metric | Result | Budget | Pass |
|---|---|---|---|
| Snapshot, 100,000 rows (400k fields), server page + client apply | 5,384 ms | under 10,000 ms | yes |
| Remote edit propagation, real HTTP + SSE hint, 20 edits | p50 6.56 ms, p99 12.28 ms | under 500 ms | yes |
| Local write, 5,000 edits, WAL | p50 0.131 ms, p99 1.154 ms, max 40 ms | p99 under 10 ms | yes |
| Revocation property test | 8 seeds x 150 random steps, replica equals fresh filtered snapshot every time | all equal | yes |
