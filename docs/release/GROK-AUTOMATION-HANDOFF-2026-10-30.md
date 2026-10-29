# Automation pickup, 30 Oct 2026

This note is the state of the Grok automation work after the local proofs were pushed. Read it before editing. The owner brief is still `GROK-AUTOMATION-FINISH-2026-10-29.md` in the team folder, and every requirement in `AUTOMATION-ENGINE-HANDOFF-2026-10-27.md` still stands.

Do not merge to main. Do not force-push, rebase, amend, stash, or reset. Do not reset the older slice worktrees. Commit as Irfad Imtiaz <irfadimtiaz7@gmail.com> with `git -c user.name="Irfad Imtiaz" -c user.email="irfadimtiaz7@gmail.com"`. No AI co-author line. Update `changelog.md` on every code change. No em dashes and no section sign.

Node that boots the app is `/Users/irfad/.nvm/versions/node/v24.15.0/bin/node`. Tests are `node --experimental-strip-types --test <file>`. Do not npm install the repo lockfile. `node_modules` in these worktrees is an untracked symlink to `/Users/irfad/Claude/Orgs/Vyre/v1-wt/rc1-integration-preflight/node_modules`. Do not commit it.

## PR 730 is not done

- Branch `grok/automation-studio`. Tip `72336acaf700b39586286fe1e5bf6ed01edf1d7e`. It already matches `origin/grok/automation-studio`. This pickup does not move it.
- PR: https://github.com/vyre-ai/vyre-v1/pull/730
- About 75 percent. The proofs below are not in this PR. CI is not green.
- Shots `40870052999` succeeded. Security `40870053006` succeeded. Affected-perf `40870053013` succeeded.
- Check `40870053008` failed only the budget, 5m16s of 5m. https://github.com/vyre-ai/vyre-v1/actions/runs/40870053008
- Fresh check `40883946308` failed fast-4, the check rollup, and the budget at 5m23s of 5m. https://github.com/vyre-ai/vyre-v1/actions/runs/40883946308
- fast-4 failed `modules/gate/tests/hold.test.ts`. That file matches origin/main and passed on the previous run. Do not rewrite gate to chase it.
- computer-lifecycle succeeded at about 4m56s. It is near the 5 minute push budget by itself. A green check on `72336aca` has no reliable ETA.
- Do not rerun `40870053008` or `40883946308`. Do not `gh run rerun --failed` on them. Do not raise `LIMIT_MIN.push` (5). Do not add `slow.json`. Do not remove computer-lifecycle from the check needs. Do not shorten `computers.live.test.ts`. Do not dispatch another check on this tip unless the 5 minute ruling changes.
- AI and Code stay hidden and are refused when turned on (`14acb01f` area). Parallel and Loop stay available.
- Package export, package import, and moving runs answer that they are not available yet. Keep that code. Do not add a feature-flag system.
- Do not close `#706`, `#731`, `#732`, `#733`, or `#738` until `#730` contains their work.

## Proof branches, pushed, not merged

These are siblings of `72336aca` except where a parent is named. They will conflict only in `changelog.md` if you merge them. Regenerate `generated/` with `node --experimental-strip-types tools/gen/src/cli.ts`. Never hand-edit `generated/` or `validators.ts`. Put any new automations capability at the end of the automations capabilities array, before `triggers:`.

| Branch | Tip | Parent | What it proves |
|---|---|---|---|
| `grok/phasea-schedule` | `367a3156` | `72336aca` | One schedule tick starts one run. 73 missed ticks: skip stays at 0, run_once starts 1, backfill over its cap pauses. Lead re-run before that commit: 2 pass. |
| `grok/phasea-proofs` | `dcddfdac` | `72336aca` | Retry does not repeat a finished step. A failed parallel lane is named. A held send resumes on the same attempt key. Lead re-run with `runs.queue.test.ts`: 8 pass. |
| `grok/phasea-rerun` | `db870032` | `72336aca` | `automations.replay` is a live rerun and requires `confirm: true`. `runs.replay` stays the sandbox and does not write the note again. Lead re-run: 1 pass. |
| `grok/phasea-sandbox` | `018e0d1a` | `72336aca` | A sandbox test reads for real. Writes and outward sends are recorded from their sample and are not performed. Replay still uses the original output. Lead re-run of the live test plus `modules/runs/tests/engine.test.ts`: 22 pass. |
| `grok/phasea-depth` | `cf146d8a` | `72336aca` | A self-trigger is dropped. Depth 8 is dropped. Both are on `automation.trigger_dropped`. The same event id starts one run. Lead re-run: 1 pass. |
| `grok/phasea-limits` | `cf068833` | `72336aca` | Loop `maxIterations` maximum is 1000 in the catalogue and in validation. A loop inside a loop is refused. `migrate_runs` answers that it is not available yet. Lead re-run of the two live tests plus `defs.test.ts`: 21 pass. |
| `grok/phasea-google` | `59173d06` | `72336aca` | A Gmail step whose connection answers 401 fails as `provider.auth_failed`. The fixture token is absent from the step. Retry uses `con_revoked` again. Lead re-run: 1 pass. No product code in this commit. |
| `grok/phasea-access` | `610f5a01` | `dcddfdac` | Olivia cannot start Noah's personal automation. A space automation run is stored as `svc_` plus the id with `aut_` removed. Lead re-run: 2 pass. |

`grok/phasea-proofs` is not only tests. It changes the engine:

- Idempotency `settle` replaces a held row of the same input hash. A finished row is left alone.
- Promoting an automation creates principal `svc_${automationId without the aut_ prefix}` when that id shape is valid.
- `drive_run` can return `retryAt`, and the host queue schedules that attempt with `Date.now()`, not the injected test clock.
- A thrown `run.*` error with a short message and no line break is returned as that error. Anything else stays `internal.unexpected`.
- The step call can carry the run id so a hold can name the run.

Review that diff before merging it into `#730`. Do not copy it blindly. `grok/phasea-access` already contains it, so merge proofs before access, or merge access and drop the duplicate.

There is no calendar skip or reschedule model on the schedule trigger. Do not invent one. Open hours exist on the wait step and on notification working hours.

## Phase B

- Branch `grok/automation-phase-b`. Tip `fb31d46b6a12a2375fe30afc6184f17e63eb021c`. Parent chain goes back to `72336aca`. About 96 percent of the Phase B flow. Not merged. This pickup pushes the branch and does not open its PR.
- The intended PR is one stacked PR whose base is `grok/automation-studio`, retargeted to main only after `#730` merges. Do not open it until the pre-push suite has been run on this tip. That suite was not run on `fb31d46b`: `node --experimental-strip-types tools/gen/src/cli.ts --check`, `node scripts/boundaries.ts`, `node scripts/security/secret-scan.ts`, `node scripts/slow-check.ts`, and `node scripts/lint/run.ts --base <merge-base origin/main>`. Gen `--check` did pass on the share commit `9f2a744c` (2734 files). Later commits did not change the manifest.
- Worktree used here: `/Users/irfad/Claude/Orgs/Vyre/v1-wt/phaseb`.

What is live on that tip:

1. Saving a shared Vault item offers once. Declining stops it. A Mine item returns 401 because the vault key is locked in these tests. Commit `f308d7db`.
2. A pasted OpenAPI document drafts actions, and one safe read marks the connector tested. Commit `97969d85`.
3. A docs page is fetched only when there is no pasted document and `app` is not a string. OpenAPI becomes actions. Any other page becomes no actions. The page text is not returned. Commit `d48548dc`.
4. The host dials a public document fetch to the addresses that already passed the check. The TLS name stays the URL hostname. A later lookup of that name is not what the socket dials. Commit `fb31d46b`. Proof is `host/src/seams/document-pin.test.ts`, 2 pass, with `tls.connect` stubbed. It does not open a public socket. Do not edit `public-fetch.ts` for this. Do not raise the caps (1_000_000 bytes, 10 seconds, 3 redirects). The refusal string is `That address is not a public host.`
5. A drafted action cannot be published. Message `A drafted action cannot be published.` Status 422. Commit `27b2cfdc`.
6. MCP `open_mcp` drafts actions. Loopback is refused before fetch. Commit `883a4efb`.
7. A tested connector can be copied to another Space as level `draft`, with no key. Commit `9f2a744c`. The copy is draft on purpose, so the receiving space does not inherit a publish right. `automations_connector_levels` has no space column. Do not "fix" that by copying `tested` into that table.
8. The agent turn transcript test does not contain the vault key. Commit `883a4efb`. It does not yet prove that a `try_read` response is absent from a turn.

Still open on Phase B:

- The Ask try button still previews through `connectors.run` with `dryRun: true` (`apps/app/src/places/automations/ask/read.ts`). Do not point it at `automations.try_read` until the proposal carries method, path, domains, and a vault handle, and the key never enters the Ask line.
- Ask proposal titles are the action key, not `Stripe: List customers`.
- Polling triggers are not built. Do not invent them. Webhook triggers come from the description where it defines them. The existing schedule trigger is not a connector polling trigger.
- A named app still uses the directory only. A pasted document still wins and is not fetched.

## Order for the next agent

1. Read this file and the two briefs named at the top.
2. Review `grok/phasea-proofs` before anything else touches kernel idempotency or the principal registrar.
3. Merge the proof branches into `grok/automation-studio` only as a reviewed merge. Changelog conflicts are expected. Do not push that result until you mean to run CI, and do not expect the 5 minute budget to pass.
4. Run the Phase B pre-push suite on `fb31d46b`. If it passes, open one PR with base `grok/automation-studio`. Do not retarget it to main before `#730` merges.
5. Report Phase A done only when CI on `#730` is green, with the PR head sha, the CI run link, and the loop pass counts. Then the lead does the security and visual review and merges into rc.2.

Definition of done is not met. No browser pass was claimed.
