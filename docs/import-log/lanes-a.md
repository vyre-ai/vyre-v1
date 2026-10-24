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

## Log

rewrite    row  24  REWRITE: `core/stream`
