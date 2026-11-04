// ci (lane l-ci-runners): a Space runs its GitHub Actions jobs on throwaway cloud machines that the Space pays for, with the Space's own cloud key. One machine runs one job and is deleted
// afterwards; the cost is recorded. GitHub's own minutes are never used, a person's computer is never used, and the Space server never runs a job.
// DECISION: the cloud key lives in the Vault. The settings hold only its handle (vaultKeyRef); the key is read by the host at the last moment and never reaches this module, a log or an event.
// DECISION: the module starts a runner only for a job whose labels all belong to the Space's label set (default "vyre") and whose repository is linked to a project in this Space. Any other job is left to GitHub.
// DECISION: a job from a fork pull request never gets a runner while the repository holds Actions secrets, or when that cannot be told. The refusal is a ci.job_refused event with the reason in plain words.
// DECISION: one machine, one job, then deleted (a just-in-time runner takes exactly one job). A sweeper every 2 minutes deletes any machine tagged vyre-ci that is older than the job limit plus 10 minutes, or has no live run.
// DECISION: at the concurrency limit a job waits in a queue and starts when a machine frees; at the monthly cap it is refused and the admins are told once a month.
// DECISION: settings are an admin's (connectors.manage) and audited. Reads of runs are for anyone who can see the project; the cost is for admins.
import { defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const repo = t.str({ pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', examples: ['vyre-ai/website'] });
const state = t.enm('queued', 'starting', 'running', 'finished', 'failed', 'swept', 'refused');
const settings = t.obj({
  enabled: t.bool(), provider: t.enm('digitalocean'), vaultKeyRef: t.nullable(id.handle), region: t.str({ examples: ['fra1'] }), size: t.str({ examples: ['s-2vcpu-4gb'] }), image: t.str({ examples: ['ubuntu-24-04-x64'] }),
  maxConcurrent: t.int({ minimum: 1, maximum: 20 }), monthlyCapUsd: t.num({ minimum: 0 }), maxJobMinutes: t.int({ minimum: 5, maximum: 360 }), labels: t.arr(t.str({ pattern: '^[A-Za-z0-9_.-]{1,40}$' }), { minItems: 1, maxItems: 5 }),
});
const run = t.obj({
  runId: t.id('cir'), jobId: t.int(), workflowRunId: t.int(), repo, jobName: t.str(), projectId: t.nullable(id.project), state, dropletId: t.nullable(t.str()), size: t.nullable(t.str()),
  queuedAt: t.ts(), startedAt: t.nullable(t.ts()), endedAt: t.nullable(t.ts()), conclusion: t.nullable(t.str()), costUsd: t.num({ minimum: 0 }), note: t.nullable(t.str({ description: 'Plain words: why it is waiting, refused or failed' })),
});
const V = { level: 'view', tool: 'engineer' } as const;

export default defineManifest({
  id: 'ci',
  title: 'CI runners',
  owner: 'L5',
  events: [
    ev('ci.run_started', 'A cloud machine was made for a job and the runner is on it', { p: { runId: t.id('cir'), repo, jobId: t.int(), dropletId: t.str(), size: t.str() }, subject: ['entity', '/runId'] }),
    ev('ci.run_finished', 'A job ended and its machine was deleted; the cost is recorded', { p: { runId: t.id('cir'), repo, jobId: t.int(), conclusion: t.str(), costUsd: t.num(), minutes: t.int() }, subject: ['entity', '/runId'] }),
    ev('ci.run_failed', 'A machine could not be made for a job, or it was lost before the job ran', { p: { runId: t.id('cir'), repo, jobId: t.int(), reason: t.str() }, subject: ['entity', '/runId'] }),
    ev('ci.run_swept', 'The sweeper deleted a machine: past its time limit, or with no live run', { p: { runId: t.nullable(t.id('cir')), dropletId: t.str(), reason: t.enm('too_long', 'no_run'), costUsd: t.num() }, subject: ['entity', '/dropletId'] }),
    ev('ci.job_refused', 'A job asked for a runner and was refused, with the reason in plain words', { p: { repo, jobId: t.int(), reason: t.str(), code: t.enm('fork_with_secrets', 'cap_reached', 'not_enabled', 'no_key') }, subject: ['entity', '/repo'] }),
    ev('ci.paused', 'CI paused: this month\'s cap is reached (once a month; the admins\' Inbox line)', { p: { title: t.str(), capUsd: t.num(), month: t.str() }, subject: ['entity', '/month'], notify: 'ci.paused' }),
    ev('ci.settings_changed', 'An admin changed the CI settings (never the key)', { p: { fields: t.arr(t.str()), enabled: t.bool() }, subject: ['entity', '/enabled'], retention: 'audit' }),
  ],
  capabilities: [
    read('ci.settings.get', 'The CI settings: whether runners are on, the cloud provider, the Vault item that holds its key (never the key), region, machine size, image, how many at once, the monthly cap, the time limit and the labels. Admin only', {
      ...V, perm: 'connectors.manage', in: {}, out: {
        settings, keyReady: t.bool({ description: 'A key is named in the settings' }),
        githubApp: t.obj({ ready: t.bool(), installed: t.bool(), missing: t.arr(t.str(), { description: 'What the GitHub App still needs, such as "actions: read"' }), acceptUrl: t.nullable(t.str()), orgAcceptUrl: t.nullable(t.str()) }, { description: 'Whether the Space\'s GitHub App has the new permissions; when not, show "<Space>\'s GitHub app needs new permissions. Accept on GitHub" with acceptUrl (a personal account) or orgAcceptUrl (an organization)' }),
      },
    }),
    write('ci.settings.set', 'Turn runners on or off and change their settings. Admin only, audited. Turning them on needs a key (a Vault item) and a monthly cap', {
      ...V, perm: 'connectors.manage', level: 'manage', in: { enabled: t.opt(t.bool()), vaultKeyRef: t.opt(t.nullable(id.handle)), region: t.opt(t.str({ pattern: '^[a-z0-9]{2,10}$' })), size: t.opt(t.str({ pattern: '^[a-z0-9-]{3,40}$' })),
        image: t.opt(t.str({ pattern: '^[A-Za-z0-9._-]{3,80}$' })), maxConcurrent: t.opt(t.int({ minimum: 1, maximum: 20 })), monthlyCapUsd: t.opt(t.num({ minimum: 0, maximum: 100000 })),
        maxJobMinutes: t.opt(t.int({ minimum: 5, maximum: 360 })), labels: t.opt(t.arr(t.str({ pattern: '^[A-Za-z0-9_.-]{1,40}$' }), { minItems: 1, maxItems: 5 })) },
      out: { settings }, emits: ['ci.settings_changed'], audit: 'always', risk: 'medium', idem: 'natural', errors: ['permission.no_grant', 'validation.bad_input', 'validation.precondition_failed'],
    }),
    read('ci.runs.list', 'Runs, newest first, for one project or one repository (give one); each has its state, machine, times and cost. Anyone who can see the project', {
      ...V, in: { projectId: t.opt(id.project), repo: t.opt(repo), state: t.opt(state), ...pageIn }, out: { runs: t.arr(run), ...pageOut }, errors: ['validation.bad_input'],
    }),
    read('ci.runs.get', 'One run', { ...V, in: { runId: t.id('cir') }, out: { run }, errors: ['validation.not_found'] }),
    read('ci.cost.month', 'What CI cost this month so far (or the month given, written 2026-11), the cap, what is left, how many runs, and the cost by repository. Admin only', {
      ...V, perm: 'connectors.manage', in: { month: t.opt(t.str({ pattern: '^\\d{4}-\\d{2}$', examples: ['2026-11'] })) },
      out: { month: t.str(), spentUsd: t.num(), capUsd: t.num(), leftUsd: t.num(), runs: t.int(), paused: t.bool(), byRepo: t.arr(t.obj({ repo, runs: t.int(), costUsd: t.num() })) },
    }),
    read('ci.project.get', 'Whether a project shows the CI tab: its repository is linked and runners are on. Anyone who can see the project', {
      ...V, in: { projectId: id.project }, out: { linked: t.bool(), repo: t.nullable(repo), enabled: t.bool(), labels: t.arr(t.str()), live: t.int({ minimum: 0 }), queued: t.int({ minimum: 0 }) },
    }),
    write('ci.job.intake', 'Host only: a job is waiting (or ended) on GitHub; start or stop its machine. Called for the workflow_job events, never by a person', {
      ...V, in: { action: t.enm('queued', 'completed'), repo, jobId: t.int(), runId: t.int(), name: t.opt(t.str()), labels: t.arr(t.str()), fork: t.opt(t.enm('no', 'yes', 'unknown')), conclusion: t.opt(t.str()) },
      out: { handled: t.enm('started', 'queued', 'refused', 'ignored', 'finished', 'failed') }, emits: ['ci.run_started', 'ci.run_failed', 'ci.run_finished', 'ci.job_refused', 'ci.paused'], offline: 'online', idem: 'natural', errors: [],
    }),
    write('ci.sweep', 'Host only: every 2 minutes, delete any machine tagged vyre-ci that is too old or has no live run, and start queued jobs that now fit', {
      ...V, in: {}, out: { deleted: t.int({ minimum: 0 }), started: t.int({ minimum: 0 }) }, emits: ['ci.run_swept', 'ci.run_started', 'ci.run_failed'], offline: 'online', errors: [],
    }),
  ],
});
