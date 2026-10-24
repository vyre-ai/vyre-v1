// github (lane L5): GitHub connector. A GitHub App per Space for repo access and webhooks (OAuth only for sign in).
// Pull requests and issues are synced record types; the connector contributes github.* capabilities. Repo mounts and
// clones belong to `mounts` and `git`; this module only mints the installation token handle they use.
// ARCHITECTURE 8 table and 8.5, spec 3.4 flow 5, 2.10.
// NOT EXPRESSIBLE: ConnectorDef.auth has no GitHub App JWT -> installation token type. The oauth2 entry is the user
// sign-in flow of the App; installation tokens are minted by github.installation_token inside the module.
// DECISION: github.installation_token never returns the token. It returns a filler handle, expiry only; git injects the
// token through the vault filler and it is never written to config.
// DECISION: merging into a protected branch declares the Gate act 'push_protected'; other writes to GitHub use 'post'.
// DECISION: "Ask author agent to fix" repeats at most 3 times per pull request (loop max 3), then answers
// validation.precondition_failed.
// DECISION: events named pull_request.*, issue.*, github.check_completed, repo.pushed are the normalised GitHub events; the raw
// delivery is github.event_received.
import { conn, defineManifest, ev, field, health, outward, read, rtype, screen, t, write } from '../packages/contracts/src/index.ts';
import type { SyncedTypeDef } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };
const quiet = (what: string) => ({ act: 'none', reason: what });
const repo = t.str({ pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', examples: ['vyre-ai/website'] });
const prRef = { repo, number: t.int({ minimum: 1 }) };
const prState = t.enm('open', 'closed', 'merged');
const checksState = t.enm('none', 'pending', 'passing', 'failing');
const prRow = t.obj({
  repo, number: t.int(), title: t.str(), state: prState, draft: t.bool(), author: t.str(), branch: t.str(), base: t.str(), url: t.str(), checks: checksState,
  labels: t.arr(t.str()), assignees: t.arr(t.str()), body: t.opt(t.str()), mergedAt: t.opt(t.ts()), additions: t.opt(t.int()), deletions: t.opt(t.int()), changedFiles: t.opt(t.int()),
});
const issueRow = t.obj({ repo, number: t.int(), title: t.str(), state: t.enm('open', 'closed'), author: t.str(), url: t.str(), labels: t.arr(t.str()), assignees: t.arr(t.str()), body: t.opt(t.str()) });
const eventName = t.enm('ping', 'installation', 'push', 'pull_request', 'issues', 'check_run', 'workflow_run');
const methodEnum = t.enm('merge', 'squash', 'rebase');

const prSync: SyncedTypeDef = {
  type: 'pull_request', remote: 'pulls',
  fields: [
    { key: 'number', remote: 'number', dir: 'pull' }, { key: 'repo', remote: 'base.repo.full_name', dir: 'pull' }, { key: 'title', remote: 'title', dir: 'pull' },
    { key: 'state', remote: 'state', dir: 'pull', transform: "merged_at != null ? 'merged' : state" }, { key: 'draft', remote: 'draft', dir: 'pull' }, { key: 'author', remote: 'user.login', dir: 'pull' },
    { key: 'branch', remote: 'head.ref', dir: 'pull' }, { key: 'base', remote: 'base.ref', dir: 'pull' }, { key: 'url', remote: 'html_url', dir: 'pull' },
    { key: 'labels', remote: 'labels', dir: 'both', transform: 'labels.map(l => l.name)' }, { key: 'assignees', remote: 'assignees', dir: 'both', transform: 'assignees.map(a => a.login)' },
    { key: 'body', remote: 'body', dir: 'pull' }, { key: 'merged_at', remote: 'merged_at', dir: 'pull' }, { key: 'additions', remote: 'additions', dir: 'pull' },
    { key: 'deletions', remote: 'deletions', dir: 'pull' }, { key: 'changed_files', remote: 'changed_files', dir: 'pull' }, { key: 'checks', remote: 'check_suites', dir: 'pull' },
  ],
  match: ['repo', 'number'], createAtSource: false, deletes: 'off', conflict: 'newest',
  polling: { activeSec: 120, idleSec: 900, dormantSec: 3600 }, nightlyReconcile: true,
};
const issueSync: SyncedTypeDef = {
  type: 'issue', remote: 'issues',
  fields: [
    { key: 'number', remote: 'number', dir: 'pull' }, { key: 'repo', remote: 'repository.full_name', dir: 'pull' }, { key: 'title', remote: 'title', dir: 'pull' },
    { key: 'state', remote: 'state', dir: 'pull' }, { key: 'author', remote: 'user.login', dir: 'pull' }, { key: 'url', remote: 'html_url', dir: 'pull' },
    { key: 'labels', remote: 'labels', dir: 'both', transform: 'labels.map(l => l.name)' }, { key: 'assignees', remote: 'assignees', dir: 'both', transform: 'assignees.map(a => a.login)' },
    { key: 'body', remote: 'body', dir: 'pull' },
  ],
  match: ['repo', 'number'], createAtSource: false, deletes: 'off', conflict: 'newest',
  polling: { activeSec: 120, idleSec: 900, dormantSec: 3600 }, nightlyReconcile: true,
};

const capabilities = [
  // ---- the GitHub App (Console > Integrations)
  write('github.app.create_manifest', 'Start the GitHub App manifest flow that creates the app in the organisation', {
    in: { org: t.str(), name: t.opt(t.str()) }, out: { manifest: t.rec(), postUrl: t.str(), state: t.str() }, perm: 'connectors.manage', risk: 'high', audit: 'always', tool: 'engineer',
  }),
  write('github.app.complete', 'Finish the manifest flow: exchange the code, store the app key in the Vault and return the install link', {
    in: { code: t.str(), state: t.str() }, out: { appId: t.int(), slug: t.str(), installUrl: t.str() }, perm: 'connectors.manage', risk: 'high', emits: ['github.app_created'], idem: 'key', audit: 'always', tool: 'engineer',
    errors: ['provider.auth_failed', 'validation.precondition_failed'],
  }),
  read('github.app.get', 'Read the GitHub App (id, permissions, subscribed events)', {
    in: {}, out: { id: t.int(), slug: t.str(), name: t.str(), permissions: t.rec(t.str()), events: t.arr(t.str()) }, perm: 'connectors.manage', tool: 'engineer',
  }),
  read('github.installations.list', 'List installations of the App', { in: {}, out: { installations: t.arr(t.obj({ id: t.int(), account: t.str(), repositorySelection: t.enm('all', 'selected') })) }, perm: 'connectors.manage', tool: 'engineer' }),
  read('github.repos.list', 'List repositories the App can reach', {
    in: { installationId: t.opt(t.int()), query: t.opt(t.str()), ...pageIn }, out: { repos: t.arr(t.obj({ repo, private: t.bool(), defaultBranch: t.str(), url: t.str() })), ...pageOut }, tool: 'records', deferred: true,
  }),
  read('github.repo.get', 'Read one repository', { in: { repo }, out: { repo, private: t.bool(), defaultBranch: t.str(), url: t.str(), description: t.opt(t.str()) }, tool: 'records', deferred: true }),
  read('github.branches.list', 'List branches of a repository (branch picker)', {
    in: { repo, ...pageIn }, out: { branches: t.arr(t.obj({ name: t.str(), sha: t.str(), protected: t.bool() })), ...pageOut }, tool: 'records', deferred: true,
  }),
  read('github.installation_token', 'Mint a short-lived installation token for git over HTTPS and return a filler handle, never the token', {
    in: { repo: t.opt(repo), installationId: t.opt(t.int()) }, out: { handle: id.handle, expiresAt: t.ts() }, risk: 'high', audit: 'always',
  }),
  read('github.health', 'Health probe: GET /app', { in: {}, out: healthOut }),
  // ---- pull requests
  read('github.pull_request.get', 'Read a pull request live from GitHub', { in: prRef, out: { pullRequest: prRow }, tool: 'records', deferred: true }),
  read('github.pull_request.list_files', 'Changed files of a pull request (the Changes tab)', {
    in: { ...prRef, ...pageIn }, out: { files: t.arr(t.obj({ path: t.str(), status: t.str(), additions: t.int(), deletions: t.int(), patch: t.opt(t.str()) })), ...pageOut }, tool: 'records', deferred: true,
  }),
  read('github.pull_request.diff', 'Unified diff of a pull request (opens as a diff tab)', { in: prRef, out: { diff: t.str() }, tool: 'records', deferred: true }),
  read('github.pull_request.checks', 'Check runs of a pull request', {
    in: prRef, out: { state: checksState, runs: t.arr(t.obj({ name: t.str(), status: t.str(), conclusion: t.opt(t.str()), url: t.opt(t.str()) })) }, tool: 'records', deferred: true,
  }),
  outward('github.pull_request.create', 'Open a pull request', {
    in: { repo, head: t.str(), base: t.str(), title: t.str(), body: t.opt(t.str()), draft: t.opt(t.bool()) }, out: { pullRequest: prRow }, gate: 'post', tool: 'records', deferred: true,
  }),
  outward('github.pull_request.update', 'Change the title, body, labels, assignees or base of a pull request', {
    in: { ...prRef, title: t.opt(t.str()), body: t.opt(t.str()), labels: t.opt(t.arr(t.str())), assignees: t.opt(t.arr(t.str())), base: t.opt(t.str()) }, out: { pullRequest: prRow }, gate: 'post', tool: 'records', deferred: true,
  }),
  outward('github.pull_request.comment', 'Comment on a pull request', { in: { ...prRef, body: t.str() }, out: { commentId: t.int() }, gate: 'post', tool: 'records', deferred: true }),
  outward('github.pull_request.request_review', 'Request a review', { in: { ...prRef, reviewers: t.arr(t.str(), { minItems: 1 }) }, out: { requested: t.bool() }, gate: 'post', tool: 'records', deferred: true }),
  outward('github.pull_request.merge', 'Merge a pull request (protected branches go through the Gate)', {
    in: { ...prRef, method: methodEnum }, out: { merged: t.bool(), sha: t.opt(t.str()) }, gate: 'push_protected', tool: 'records', deferred: true, errors: ['validation.precondition_failed'],
  }),
  outward('github.pull_request.close', 'Close a pull request without merging', { in: prRef, out: { closed: t.bool() }, gate: 'post', tool: 'records', deferred: true }),
  outward('github.pull_request.rerun_checks', 'Re-run failed checks', { in: prRef, out: { requested: t.bool() }, gate: quiet('Asks GitHub to run checks again on the same commit; nobody is notified'), tool: 'records', deferred: true }),
  write('github.pull_request.ask_author_fix', 'Ask the author agent to fix a failing check: creates a task (at most 3 rounds per pull request)', {
    in: { recordId: id.record, checkName: t.opt(t.str()) }, out: { taskId: id.task, attempt: t.int({ minimum: 1, maximum: 3 }) }, on: ['record', '/recordId'], perm: 'records.edit',
    emits: ['github.fix_requested'], idem: 'key', tool: 'records', errors: ['validation.precondition_failed'],
  }),
  // ---- issues
  read('github.issue.get', 'Read an issue live from GitHub', { in: { repo, number: t.int({ minimum: 1 }) }, out: { issue: issueRow }, tool: 'records', deferred: true }),
  outward('github.issue.create', 'Open an issue', { in: { repo, title: t.str(), body: t.opt(t.str()), labels: t.opt(t.arr(t.str())), assignees: t.opt(t.arr(t.str())) }, out: { issue: issueRow }, gate: 'post', tool: 'records', deferred: true }),
  outward('github.issue.update', 'Change the title, body, labels or assignees of an issue', {
    in: { repo, number: t.int({ minimum: 1 }), title: t.opt(t.str()), body: t.opt(t.str()), labels: t.opt(t.arr(t.str())), assignees: t.opt(t.arr(t.str())) }, out: { issue: issueRow }, gate: 'post', tool: 'records', deferred: true,
  }),
  outward('github.issue.comment', 'Comment on an issue', { in: { repo, number: t.int({ minimum: 1 }), body: t.str() }, out: { commentId: t.int() }, gate: 'post', tool: 'records', deferred: true }),
  outward('github.issue.close', 'Close an issue', { in: { repo, number: t.int({ minimum: 1 }) }, out: { closed: t.bool() }, gate: 'post', tool: 'records', deferred: true }),
  write('github.issue.assign_agent', 'Assign an issue to an agent: creates a task whose result lands as a linked changeset', {
    in: { recordId: id.record, agentId: id.agent }, out: { taskId: id.task }, on: ['record', '/recordId'], perm: 'records.edit', emits: ['github.issue_assigned'], idem: 'key', tool: 'records',
  }),
  // ---- webhook intake
  write('github.receive_webhook', 'Record a verified GitHub delivery after dedupe; normalise push, pull request, issue, check and workflow events', {
    in: { deliveryId: t.str(), event: eventName, action: t.opt(t.str()), repo: t.opt(repo), installationId: t.opt(t.int()), number: t.opt(t.int()), sha: t.opt(t.str()), branch: t.opt(t.str()), conclusion: t.opt(t.str()), name: t.opt(t.str()) },
    out: { accepted: t.bool() },
    emits: ['github.event_received', 'repo.pushed', 'pull_request.opened', 'pull_request.merged', 'pull_request.closed', 'issue.opened', 'github.check_completed', 'workflow.completed'], idem: 'natural', offline: 'online',
  }),
];

const rn = { repo, number: t.int() };

export default defineManifest({
  id: 'github',
  title: 'GitHub',
  kind: 'connector',
  owner: 'L5',
  recordTypes: [
    rtype('pull_request', 'Pull request', 'Pull requests', 'git-pull-request', [
      field('title', 'text', 'Title', { required: true }),
      field('number', 'number', 'Number'),
      field('repo', 'text', 'Repository'),
      field('state', 'status', 'State', { default: 'open', options: { stages: [{ key: 'open', title: 'Open' }, { key: 'closed', title: 'Closed' }, { key: 'merged', title: 'Merged' }] } }),
      field('draft', 'checkbox', 'Draft'),
      field('author', 'text', 'Author'),
      field('author_agent', 'text', 'Author agent'),
      field('branch', 'text', 'Branch'),
      field('base', 'text', 'Base'),
      field('url', 'url', 'Link'),
      field('labels', 'multichoice', 'Labels'),
      field('assignees', 'text', 'Assignees'),
      field('checks', 'choice', 'Checks', { default: 'none', options: { choices: [{ key: 'none', title: 'None' }, { key: 'pending', title: 'Pending' }, { key: 'passing', title: 'Passing' }, { key: 'failing', title: 'Failing' }] } }),
      field('body', 'longtext', 'Description'),
      field('merged_at', 'datetime', 'Merged'),
      field('additions', 'number', 'Lines added'),
      field('deletions', 'number', 'Lines removed'),
      field('changed_files', 'number', 'Files changed'),
      field('preview_site', 'text', 'Preview site'),
    ], { statusField: 'state', group: 'Code', summaryField: 'repo' }),
    rtype('issue', 'Issue', 'Issues', 'circle-dot', [
      field('title', 'text', 'Title', { required: true }),
      field('number', 'number', 'Number'),
      field('repo', 'text', 'Repository'),
      field('state', 'status', 'State', { default: 'open', options: { stages: [{ key: 'open', title: 'Open' }, { key: 'closed', title: 'Closed' }] } }),
      field('author', 'text', 'Author'),
      field('url', 'url', 'Link'),
      field('labels', 'multichoice', 'Labels'),
      field('assignees', 'text', 'Assignees'),
      field('body', 'longtext', 'Description'),
      field('assigned_task', 'text', 'Agent task'),
    ], { statusField: 'state', group: 'Code', summaryField: 'repo' }),
  ],
  events: [
    ev('github.app_created', 'The GitHub App was created and its key stored', { p: { appId: t.int(), slug: t.str() }, subject: ['entity', '/slug'] }),
    ev('github.event_received', 'A verified GitHub delivery arrived', { p: { deliveryId: t.str(), event: eventName, action: t.opt(t.str()), repo: t.opt(repo) }, subject: ['entity', '/deliveryId'] }),
    ev('github.fix_requested', 'The author agent was asked to fix a failing check', { p: { recordId: id.record, taskId: id.task, attempt: t.int() }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('github.issue_assigned', 'An issue was assigned to an agent', { p: { recordId: id.record, taskId: id.task, agentId: id.agent }, subject: ['record', '/recordId'], label: 'subject' }),
    ev('repo.pushed', 'Commits were pushed to a branch', { p: { ...rn, branch: t.str(), sha: t.str() }, subject: ['entity', '/repo'], trigger: { title: 'Code is pushed', fields: ['/repo', '/branch'] } }),
    ev('pull_request.opened', 'A pull request was opened', { p: { ...rn, recordId: t.opt(id.record), author: t.str() }, subject: ['entity', '/repo'], trigger: { title: 'A pull request is opened', fields: ['/repo'] } }),
    ev('pull_request.merged', 'A pull request was merged', { p: { ...rn, recordId: t.opt(id.record) }, subject: ['entity', '/repo'] }),
    ev('pull_request.closed', 'A pull request was closed without merging', { p: { ...rn, recordId: t.opt(id.record) }, subject: ['entity', '/repo'] }),
    ev('issue.opened', 'An issue was opened', { p: { ...rn, recordId: t.opt(id.record), author: t.str() }, subject: ['entity', '/repo'], trigger: { title: 'An issue is opened', fields: ['/repo'] } }),
    ev('github.check_completed', 'A check run finished', {
      p: { repo, sha: t.str(), name: t.str(), conclusion: t.enm('success', 'failure', 'neutral', 'cancelled', 'timed_out', 'action_required'), number: t.opt(t.int()) }, subject: ['entity', '/repo'],
      trigger: { title: 'A CI check finishes', fields: ['/repo', '/name', '/conclusion'] },
    }),
    ev('workflow.completed', 'A workflow run finished', { p: { repo, name: t.str(), conclusion: t.str(), sha: t.str() }, subject: ['entity', '/repo'] }),
  ],
  capabilities,
  connectors: [
    conn('github', 'GitHub', {
      mode: 'oauth_app', scope: 'space',
      auth: { type: 'oauth2', authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scopes: ['read:user', 'user:email'], pkce: true },
      domains: ['api.github.com', 'github.com'],
      secrets: [
        { name: 'GitHub_App_Key', description: 'GitHub App private key (PEM) used to mint installation tokens' },
        { name: 'GitHub_App_Client_Secret', description: 'GitHub App OAuth client secret (sign in)' },
        { name: 'GitHub_App_Webhook_Secret', description: 'Secret that signs /hooks/github' },
      ],
      sources: [{ key: 'github', path: '/hooks/github', verify: 'hmac', event: 'github.event_received', dedupe: '/deliveryId' }],
      syncedTypes: [prSync, issueSync], actions: capabilities.map((c) => c.name), rate: { rps: 10, burst: 30 }, health: 'github.app',
    }),
  ],
  health: [
    health('github.app', 'GitHub App', 'github.health', 'Check the GitHub App key in the Vault and that the App is still installed on the organisation.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('github.pull-request', 'records', 'ui:PullRequestPage', {
      q: {
        pullRequest: ['github.pull_request.get', { repo: '/state/repo', number: '/state/number' }, true], files: ['github.pull_request.list_files', { repo: '/state/repo', number: '/state/number' }, true],
        checks: ['github.pull_request.checks', { repo: '/state/repo', number: '/state/number' }, true], diff: ['github.pull_request.diff', { repo: '/state/repo', number: '/state/number' }, false],
      },
      a: {
        askFix: ['github.pull_request.ask_author_fix', { recordId: '/state/recordId', checkName: '/state/checkName' }], rerun: ['github.pull_request.rerun_checks', { repo: '/state/repo', number: '/state/number' }],
        comment: ['github.pull_request.comment', { repo: '/state/repo', number: '/state/number', body: '/state/body' }], merge: ['github.pull_request.merge', { repo: '/state/repo', number: '/state/number', method: '/state/method' }, 'Merge this pull request?'],
        close: ['github.pull_request.close', { repo: '/state/repo', number: '/state/number' }, 'Close this pull request without merging?'],
      },
      empty: 'Pull request not found',
    }),
    screen('github.issue', 'records', 'ui:IssuePage', {
      q: { issue: ['github.issue.get', { repo: '/state/repo', number: '/state/number' }, true] },
      a: { assign: ['github.issue.assign_agent', { recordId: '/state/recordId', agentId: '/state/agentId' }], comment: ['github.issue.comment', { repo: '/state/repo', number: '/state/number', body: '/state/body' }], close: ['github.issue.close', { repo: '/state/repo', number: '/state/number' }, 'Close this issue?'] },
      empty: 'Issue not found',
    }),
    screen('github.setup', 'console', 'ui:GithubAppWizard', {
      q: { app: ['github.app.get', {}, true], repos: ['github.repos.list', { query: '/state/query' }, true] },
      a: { create: ['github.app.create_manifest', { org: '/state/org', name: '/state/name' }], complete: ['github.app.complete', { code: '/state/code', state: '/state/state' }] },
      empty: 'GitHub is not connected', primary: 'Create the GitHub App', needs: ['connectors.manage'],
    }),
  ],
});
