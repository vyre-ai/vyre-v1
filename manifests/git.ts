// git (lane L4): any folder can be a git repository; local history is automatic, remotes are optional (spec 2.16, architecture 7.5 and 8.5).
// Repository work runs the git binary against the real working tree at data/trees/<folderId>. Remote auth is an installation token injected by the filler, never written to git config and never in these inputs.
// DECISION: protected branches are a per-folder list with a Space default (setting git.protected_branches). A push to one raises the push_protected Gate line for agents, automations and people alike (that act applies to humans too).
// DECISION: there is no force push capability in v1.
// DECISION: git.push and git.sync declare gate push_protected with when "git.is_protected(input.branch)"; the Gate binds git to the folder git settings when it evaluates the expression.
// DECISION: working-copy changes of a git folder are a changeset (files module); git.diff is the raw read behind it.
import { defineManifest, ev, health, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const sha = t.str({ pattern: '^[0-9a-f]{7,40}$', examples: ['9fceb02'] });
const branch = t.str({ examples: ['main'] });
const remoteName = t.str({ pattern: '^[A-Za-z0-9._-]+$', examples: ['origin'] });
const httpsUrl = t.str({ pattern: '^https://[^@\\s]+$', description: 'HTTPS remote address without credentials', examples: ['https://github.com/vyre-ai/website.git'] });
const mergeStrategy = t.opt(t.enm('merge', 'rebase', 'ff_only'));

const author = t.obj({ name: t.str(), kind: t.enm('person', 'agent', 'actor', 'external'), id: t.opt(t.str()) });
const commitRow = t.obj({ sha, message: t.str(), author, at: t.ts(), files: t.int({ minimum: 0 }), parents: t.arr(sha) });
const fileChange = t.obj({ path: t.str(), status: t.enm('added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted'), added: t.int(), removed: t.int(), staged: t.bool() });
const hunk = t.obj({ hunkId: t.str(), oldStart: t.int(), oldLines: t.int(), newStart: t.int(), newLines: t.int(), lines: t.arr(t.obj({ op: t.enm('ctx', 'add', 'del'), text: t.str() })) });
const folderOn = ['folder', '/folderId'] as const;

export default defineManifest({
  id: 'git',
  title: 'Git',
  owner: 'L4',
  settings: [
    setting('git.protected_branches', 'space', 'files', 'Branches that need an approved push', t.arr(t.str()), ['main', 'master']),
  ],
  events: [
    ev('git.initialized', 'A folder became a git repository', { p: { folderId: id.folder, branch }, subject: ['folder', '/folderId'] }),
    ev('git.committed', 'A commit was made (authored by the first editor, person or agent)', {
      p: { folderId: id.folder, sha, branch, by: t.str(), files: t.int(), message: t.str() }, subject: ['folder', '/folderId'], trigger: { title: 'A commit is made', fields: ['/folderId', '/branch'] },
    }),
    ev('git.pulled', 'The folder pulled from its remote', { p: { folderId: id.folder, branch, from: t.opt(sha), to: sha, conflicts: t.int() }, subject: ['folder', '/folderId'] }),
    ev('git.pushed', 'The folder pushed to its remote', { p: { folderId: id.folder, branch, remote: remoteName, sha, protectedBranch: t.bool() }, subject: ['folder', '/folderId'], replay: 'stub', trigger: { title: 'A push happens', fields: ['/folderId', '/branch'] } }),
    ev('git.branch_changed', 'A branch was created, switched to or deleted', { p: { folderId: id.folder, branch, action: t.enm('create', 'switch', 'delete') }, subject: ['folder', '/folderId'] }),
    ev('git.remote_added', 'A remote was added', { p: { folderId: id.folder, name: remoteName }, subject: ['folder', '/folderId'] }),
    ev('git.remote_removed', 'A remote was removed', { p: { folderId: id.folder, name: remoteName }, subject: ['folder', '/folderId'] }),
    ev('git.protection_changed', 'The protected branches of a folder changed', { p: { folderId: id.folder, branches: t.arr(t.str()) }, subject: ['folder', '/folderId'] }),
  ],
  capabilities: [
    write('git.init', 'Turn a folder into a git repository (local history only until a remote is added)', {
      in: { folderId: id.folder, branch: t.opt(branch) }, out: { branch }, on: folderOn, perm: 'files.write', level: 'manage', emits: ['git.initialized'], tool: 'files', cli: 'vyre git init',
    }),
    read('git.status', 'Branch, ahead and behind counts, changed files, remotes and whether the branch is protected', {
      in: { folderId: id.folder },
      out: {
        isRepo: t.bool(), branch: t.opt(branch), upstream: t.opt(t.str()), head: t.opt(sha), ahead: t.int({ minimum: 0 }), behind: t.int({ minimum: 0 }), clean: t.bool(),
        changes: t.arr(fileChange), remotes: t.arr(t.obj({ name: remoteName, url: httpsUrl })), protected: t.bool(),
      },
      on: folderOn, tool: 'files', label: 'check', cli: 'vyre git status',
    }),
    read('git.log', 'Commit history of the folder, a path or a branch, with authors', {
      in: { folderId: id.folder, path: t.opt(t.str()), branch: t.opt(branch), limit: t.opt(t.int({ minimum: 1, maximum: 500 })), before: t.opt(sha) },
      out: { commits: t.arr(commitRow), next: t.opt(sha) }, on: folderOn, tool: 'files', label: 'check', cli: 'vyre git log',
    }),
    read('git.show', 'One commit: its files with counts, and the hunks of one path if given (opens as a Diff tab)', {
      in: { folderId: id.folder, sha, path: t.opt(t.str()) }, out: { commit: commitRow, files: t.arr(fileChange), hunks: t.arr(hunk) }, on: folderOn, tool: 'files', label: 'check',
    }),
    read('git.diff', 'Working-copy changes against HEAD, or between two commits or branches', {
      in: { folderId: id.folder, from: t.opt(t.str()), to: t.opt(t.str()), path: t.opt(t.str()) }, out: { files: t.arr(fileChange), hunks: t.arr(hunk) }, on: folderOn, tool: 'files', label: 'check', cli: 'vyre git diff',
    }),
    read('git.list_branches', 'Branches and remote branches for the branch picker', {
      in: { folderId: id.folder }, out: { current: t.opt(branch), branches: t.arr(t.obj({ name: branch, remote: t.bool(), sha, protected: t.bool(), ahead: t.opt(t.int()), behind: t.opt(t.int()) })) }, on: folderOn, tool: 'files',
    }),
    write('git.commit', 'Commit working-copy changes (all or the given paths); authored by the first editor, person or agent', {
      in: { folderId: id.folder, message: t.str({ minLength: 1 }), paths: t.opt(t.arr(t.str())), author: t.opt(author) }, out: { sha, files: t.int() },
      on: folderOn, perm: 'files.write', idem: 'key', emits: ['git.committed', 'file.version_added'], tool: 'files', cli: 'vyre git commit', errors: ['validation.precondition_failed'],
    }),
    write('git.branch', 'Create, switch to or delete a branch', {
      in: { folderId: id.folder, action: t.enm('create', 'switch', 'delete'), name: branch, from: t.opt(t.str()) }, out: { branch },
      on: folderOn, perm: 'files.write', emits: ['git.branch_changed'], tool: 'files', cli: 'vyre git branch', errors: ['validation.precondition_failed', 'validation.duplicate'],
    }),
    write('git.pull', 'Pull from the remote with a merge, rebase or fast-forward; conflicts are listed, not hidden', {
      in: { folderId: id.folder, remote: t.opt(remoteName), branch: t.opt(branch), strategy: mergeStrategy }, out: { updated: t.bool(), sha: t.opt(sha), conflicts: t.arr(t.str()) },
      on: folderOn, perm: 'files.write', emits: ['git.pulled', 'file.version_added'], tool: 'files', cli: 'vyre git pull', errors: ['provider.auth_failed', 'provider.unavailable', 'validation.precondition_failed'],
    }),
    outward('git.push', 'Push the branch to the remote; a push to a protected branch raises a Gate line', {
      in: { folderId: id.folder, remote: t.opt(remoteName), branch: t.opt(branch) }, out: { pushed: t.bool(), sha: t.opt(sha) },
      on: folderOn, perm: 'files.write', gate: { act: 'push_protected', when: 'git.is_protected(input.branch)' }, emits: ['git.pushed'], tool: 'files', cli: 'vyre git push',
      errors: ['provider.auth_failed', 'provider.unavailable', 'permission.needs_approval', 'validation.precondition_failed'],
    }),
    outward('git.sync', 'Pull then push in one step (the Sync button of a mounted repository)', {
      in: { folderId: id.folder, remote: t.opt(remoteName), branch: t.opt(branch), strategy: mergeStrategy }, out: { pulled: t.bool(), pushed: t.bool(), conflicts: t.arr(t.str()), sha: t.opt(sha) },
      on: folderOn, perm: 'files.write', gate: { act: 'push_protected', when: 'git.is_protected(input.branch)' }, emits: ['git.pulled', 'git.pushed', 'file.version_added'], tool: 'files',
      errors: ['provider.auth_failed', 'provider.unavailable', 'permission.needs_approval'],
    }),
    write('git.remote_add', 'Add a remote by HTTPS address (credentials never go in the address)', {
      in: { folderId: id.folder, name: remoteName, url: httpsUrl }, out: { ok: t.bool() }, on: folderOn, perm: 'files.write', level: 'manage', audit: 'always', emits: ['git.remote_added'], tool: 'files', cli: 'vyre git remote add', errors: ['validation.duplicate'],
    }),
    write('git.remote_remove', 'Remove a remote', {
      in: { folderId: id.folder, name: remoteName }, out: { ok: t.bool() }, on: folderOn, perm: 'files.write', level: 'manage', audit: 'always', emits: ['git.remote_removed'], tool: 'files',
    }),
    write('git.protect', 'Set which branches of this folder are protected (pushes to them need an approved Gate line)', {
      in: { folderId: id.folder, branches: t.arr(t.str()) }, out: { branches: t.arr(t.str()) }, on: folderOn, perm: 'policy.manage', level: 'manage', audit: 'always', emits: ['git.protection_changed'], tool: 'files',
    }),
    read('git.health', 'The git binary is present and runs', { out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), version: t.opt(t.str()) } }),
  ],
  health: [
    health('git.binary', 'Git on the server', 'git.health', 'Reinstall git on the server or restart the files service in the Console.'),
  ],
  screens: [
    screen('files.git-row', 'files', 'ui:GitRow', {
      slot: 'side',
      q: { status: ['git.status', { folderId: '/state/folder' }], branches: ['git.list_branches', { folderId: '/state/folder' }, false], log: ['git.log', { folderId: '/state/folder', path: '/state/path' }, false] },
      a: {
        commit: ['git.commit', { folderId: '/state/folder', message: '/draft/message', paths: '/draft/paths' }],
        branch: ['git.branch', { folderId: '/state/folder', action: '/draft/action', name: '/draft/name' }],
        pull: ['git.pull', { folderId: '/state/folder', strategy: '/draft/strategy' }],
        push: ['git.push', { folderId: '/state/folder', branch: '/state/branch' }],
        sync: ['git.sync', { folderId: '/state/folder' }],
        addRemote: ['git.remote_add', { folderId: '/state/folder', name: '/draft/name', url: '/draft/url' }],
        init: ['git.init', { folderId: '/state/folder' }],
      },
      needs: ['files.write'], empty: 'Not a git folder', primary: 'Start history',
    }),
    screen('files.commit-diff', 'files', 'ui:DiffTab', {
      slot: 'tab', q: { commit: ['git.show', { folderId: '/state/folder', sha: '/state/sha', path: '/state/path' }] }, empty: 'No differences',
    }),
  ],
});
