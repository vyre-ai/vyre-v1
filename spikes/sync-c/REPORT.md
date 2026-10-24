# Sync spike C report (S5 web half, S6)

Browser run: https://github.com/vyre-ai/vyre-v1/actions/runs/40109672513 (headless Chrome, chromium-headless-shell, self-hosted v1 runner, sqlite-wasm-cipher 2.2.4 = SQLite 3.50.4 with Multiple Ciphers, chacha20).
Engine runs: https://github.com/vyre-ai/vyre-v1/actions/runs/40108162289 (node:sqlite and wa-sqlite).

## S5 web: encrypted sqlite3mc on OPFS, 200,000 rows

| Metric | Result | Budget |
|---|---|---|
| Insert 200k rows (one transaction) | 3,004 ms | none |
| Reopen with key | 77 ms | none |
| Query: count + sum + read all 200k rows | 2,184 ms (200,000 rows read) | none |
| Reactive 10k list, refresh after an update (re-read row, patch list) | p50 2.9 ms, p99 9.78 ms | under 16 ms, met |
| Single-row write commit (one transaction per edit) | p50 28 ms, p99 71 ms | none; batch 100 edits in one transaction = 63 ms |
| Full re-run of the 10k list query | 105 ms | none |
| No key / wrong key | both rejected | rejected |
| Plaintext marker in any OPFS file | not found | none |

Findings:
1. A key cannot be set on the stock `opfs` or `opfs-sahpool` VFS ("Encryption is not supported by the VFS"). Call `sqlite3.capi.sqlite3mc_vfs_create("<vfs>", 0)` first, then open `file:/x.db?vfs=multipleciphers-<vfs>`. Both wrapped VFS accept the key. Use the wrapped SAH-pool VFS (synchronous, no COOP/COEP needed for it).
2. One commit per edit costs 28 ms median on OPFS, so the UI must patch its list from the optimistic edit and write in batches (100 edits in one transaction took 63 ms).
3. Do not re-run the 10k list query per edit (105 ms); refresh per changed row.

## S6 reactive layer (engine, Node)

| Engine | Reactive update p99 | Budget |
|---|---|---|
| node:sqlite + AES-GCM, live 10k list | 0.545 ms | under 16 ms |
| wa-sqlite + AES-GCM, per-row refresh of cached 10k list | 2.43 ms | under 16 ms |

Phone runs (SQLCipher on iPhone and Android, 200k-row query on device, Hermes) moved to P-PR_47b.
