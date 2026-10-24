# 0.6 import log

`scripts/import-0.6.ts` copies the KEEP and CLEAN rows of ARCHITECTURE-V1 section 11 from the 0.6.9 tree into the v1 destination folders (F12). It does no cleaning and no ports.

```
node scripts/import-0.6.ts --arch <ARCHITECTURE-V1.md> --src <0.6.9 tree>                 # dry run, prints the log
node scripts/import-0.6.ts --arch ... --src ... --apply --commit --log docs/import-log/run.txt
```

Rules:

- Every copied JS, TS, shell and Python file starts with `// from vyre 0.6.9 <path>@<sha>` (`#` for shell and Python). A shebang stays on line 1. Other file types are copied unchanged and logged as `headerless`.
- Rows marked REWRITE, DROP, `KEEP idea` or `port selectively` are logged, never copied.
- A destination file that already exists is left alone and logged as `exists`.
- The destination is the first folder named in the row. The lane is the longest matching prefix in `scripts/lanes.json`; `--commit` makes one commit per lane.
- Log kinds: `imported`, `headerless`, `exists`, `missing` (source not found, exit 1), `nodest` (no folder named, exit 1), `rewrite`, `drop`, `idea`.
- Rows that name only a directory copy the whole directory except `node_modules`, `.git`, `dist`, `build`, `.next` and `coverage`.
