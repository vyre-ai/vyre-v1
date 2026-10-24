# Lane brief template (F13)

Placeholders in double braces are filled by `scripts/brief/build.ts`. A lane doc `docs/lanes/<lane>.md` uses the same section order; the builder pastes it under "Lane notes".

## Goal
{{goal}}

## Spec sections
{{spec}}

## Files you may edit
{{owned}}

Edit nothing outside these globs. If the layout on main differs from the paths here, comment the mapping on the packet and use the real paths.

## Reuse from 0.6 and traps
{{reuse}}

## Capabilities, in dependency order
{{capabilities}}

## Interfaces consumed
{{interfaces}}

## Tests that must turn green
{{tests}}

## Budgets
{{budgets}}

## Checklist
{{checklist}}

## What done means
Every checklist item has its own evidence. Every test file named in evidence shows "ok" in the linked CI run. Perf items give the number against the budget. Required proof kinds: {{proofs}}.

## Lane notes
{{lane}}
