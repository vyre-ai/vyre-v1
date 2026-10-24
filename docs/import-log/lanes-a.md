# F12 run A import log (P-PR_40)

Section 11 rows for lanes L1, L3, L6, L7a (the packet's L7) and L7b.
kernel/grants is included because the build step names grants. Its destination `kernel/src/grants` is frozen and matches no lane in scripts/lanes.json, so the tool tags those lines unowned. The lines are committed with L7a.

Rules match scripts/import-0.6.ts. KEEP and CLEAN are copy rows (logged imported or headerless, one line per file). REWRITE and DROP are logged and not copied. The copy target is the first destination folder. The lane tag is the longest owns prefix.
No section 11 row whose destination lane is one of these is DROP.
Source paths come from the wt-train067 (0.6.9) file survey. This packet may edit only this log, so the lines are the import record and the file bytes are not written into other lanes.

## Row marks

| Row | Lane | Mark | 0.6 path |
|---|---|---|---|
| 24 | L1 | REWRITE | `core/stream` |
| 32 | L3 | REWRITE | `core/work`, `core/projects`, `core/goals`, `core/waiting`, `core/team` |
| 50 | L3 | imported | `core/import` to `modules/records` (12 files) |

## Log

rewrite    row  24  REWRITE: `core/stream`
rewrite    row  32  REWRITE small: `core/work`, `core/projects`, `core/goals`, `core/waiting`, `core/team
imported   row  50  core/import/formats/codex.js -> modules/records/formats/codex.js [L3]
imported   row  50  core/import/formats/formats.test.js -> modules/records/formats/formats.test.js [L3]
imported   row  50  core/import/formats/gemini.js -> modules/records/formats/gemini.js [L3]
imported   row  50  core/import/formats/import-agents.test.js -> modules/records/formats/import-agents.test.js [L3]
imported   row  50  core/import/formats/index.js -> modules/records/formats/index.js [L3]
imported   row  50  core/import/formats/shared.js -> modules/records/formats/shared.js [L3]
imported   row  50  core/import/import.test.js -> modules/records/import.test.js [L3]
imported   row  50  core/import/index.js -> modules/records/index.js [L3]
headerless row  50  core/import/module.json -> modules/records/module.json [L3]
imported   row  50  core/import/scan.js -> modules/records/scan.js [L3]
imported   row  50  core/import/sessions-import.test.js -> modules/records/sessions-import.test.js [L3]
imported   row  50  core/import/start.test.js -> modules/records/start.test.js [L3]
