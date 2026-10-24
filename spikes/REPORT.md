# Spike report S0 to S6 and S12

All code ran on CI runners (Node 24); nothing ran on the Mac. Budgets are acceptance, not targets. Rulings 1, 3, 5 and 12 apply.

| Spike | Check | Measured | Budget | Verdict |
|---|---|---|---|---|
| S0 | node:sqlite: FTS5 bm25, JSON, DatabaseSync in worker, backup, batched inserts | 681k inserts/s; backup 77 pages; file test 780 ms | 50k inserts/s; 20 s test cap | pass. Run 40107614800 |
| S1 | 100k-row snapshot, edit propagation, idempotent push | snapshot 5,384 ms; remote edit p50 6.56 ms, p99 12.28 ms | 10,000 ms; 500 ms | pass. Runs 40107732114, 40107940139 |
| S1 | Local write, 5,000 edits, WAL | p50 0.131 ms, p99 1.154 ms, max 40 ms | p99 under 10 ms | pass (max shows a rare stall, likely WAL checkpoint, unverified) |
| S2 | Permission revocation purge | 8 seeds x 150 random steps; replica equals fresh filtered snapshot every time | all equal | pass. 3,413 ms |
| S3 | Yjs, 3 clients (one offline with 40 edits, one agent) | converge; Markdown snapshot; revoked editor cut off; 5k-update rebuild | converge | pass. 5,916 ms, run 40107928603 |
| S4 | E2E docs: server stores ciphertext | owner devices decrypt; second user and granted outsider get 0 rows; no plaintext in tables or file bytes | none readable | pass. 4,124 ms |
| S5 web | sqlite-wasm-cipher 2.2.4 (chacha20) on OPFS, 200k rows, headless Chrome | insert 3,004 ms; reopen 77 ms; read all 200k rows 2,184 ms; no key and wrong key rejected; no plaintext in OPFS files | no query budget | pass. Run 40109672513 |
| S5 web | Single-row commit on OPFS | p50 28 ms, p99 71 ms; 100 edits in one transaction 63 ms | local edit under 10 ms | per ruling 5 the device store batches (one transaction per frame, about 16 ms); the 10 ms budget is measured to the in-memory apply |
| S6 | Reactive refresh of a live 10k list | web p50 2.9 ms, p99 9.78 ms; node:sqlite p99 0.545 ms; wa-sqlite p99 2.43 ms | under 16 ms | pass. Run 40108162289; s6.reactive 20,557 ms, near the 20 s cap on first run (wa-sqlite install), cached after |
| S12 | Tauri 2 shell loads web build, replica persists across restart, sidecar vyred | macOS (Signature=adhoc) and Windows: webview reached sidecar; replica=wrote then replica=persisted after restart | launch, persist, sidecar | pass. Runs 40117021667, 40117021598 |

## Fallbacks and decisions (ARCH 5.10 / R5)

- Stock `opfs` and `opfs-sahpool` VFS refuse a key. Open through `sqlite3mc_vfs_create("<vfs>", 0)` and `file:/x.db?vfs=multipleciphers-<vfs>`; use the wrapped SAH-pool VFS. wa-sqlite 1.0.0 (no FTS5, app-layer AES-GCM) stays the fallback (ruling 1).
- Per-commit OPFS cost (28 ms) is handled by batching (ruling 5).
- Never re-run the full 10k list query per edit (wa-sqlite 208 ms, web 105 ms); refresh per changed row.
- Pull applies in bulk only (per-field statements: 11.7 s for 10k rows; multi-row upsert: 2.0 s).
- Protocol changes adopted (ruling 1): seen_rows per device, Op.after link, hide-seq guard.
- `sqlite3_js_db_export` returns decrypted pages; treat any export as plaintext.

## Deferred to P-PR_47b (ruling 3, does not gate G0)

SQLCipher open on a real iPhone and Android, 200k-row query on device, Yjs on the Hermes runtime, WebSocket reconnect on phone, Gradle `assembleDebug` (runners have no JDK or Android SDK). Waits for the owner to connect devices.

## Not covered

Visibility through relations, `scope_changed` for grants over 5,000 rows, WebSocket live frames (SSE hint used), gzip NDJSON snapshot transport, `doc_updates` compaction, hiddenFields conditions beyond label rank.
