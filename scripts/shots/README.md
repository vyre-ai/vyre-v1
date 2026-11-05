# Screenshots (scripts/shots)

- Each UI packet owns a mount (`mounts/<ID>.tsx`, served at `/m/<ID>`) and a target file (`targets/<ID>.json`). Nothing else needs editing to add one.
- The page boot script (`app/app/+html.tsx`) reads two query names for the skin: `?skin=<id>` and `?mode=light|dark`. **Never use `?mode=` (or `?skin=`) for your own mount option.** A value like `?mode=week` finds no tokens, so no skin variables load and paper and graphite shots come out identical and unstyled. Use another name (`?view=`, `?open=`, `?tab=`).
- Mount options are read after hydration (`useEffect` then `URLSearchParams`), so the static HTML and the first client render match.
- A sample that shows dates should move to the real today (see `inbox/calendar/sample.ts`, `shiftDays`) so a shot never says a past week.
