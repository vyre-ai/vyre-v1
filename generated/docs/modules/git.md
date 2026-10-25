# Git (git)

Lane L4. Kind module. Version 0.1.0.

Requires: files.

## Capabilities (15)

- [git.branch](../capabilities/git.branch.md): Create, switch to or delete a branch
- [git.commit](../capabilities/git.commit.md): Commit working-copy changes (all or the given paths); authored by the first editor, person or agent
- [git.diff](../capabilities/git.diff.md): Working-copy changes against HEAD, or between two commits or branches
- [git.health](../capabilities/git.health.md): The git binary is present and runs
- [git.init](../capabilities/git.init.md): Turn a folder into a git repository (local history only until a remote is added)
- [git.list_branches](../capabilities/git.list_branches.md): Branches and remote branches for the branch picker
- [git.log](../capabilities/git.log.md): Commit history of the folder, a path or a branch, with authors
- [git.protect](../capabilities/git.protect.md): Set which branches of this folder are protected (pushes to them need an approved Gate line)
- [git.pull](../capabilities/git.pull.md): Pull from the remote with a merge, rebase or fast-forward; conflicts are listed, not hidden
- [git.push](../capabilities/git.push.md): Push the branch to the remote; a push to a protected branch raises a Gate line
- [git.remote_add](../capabilities/git.remote_add.md): Add a remote by HTTPS address (credentials never go in the address)
- [git.remote_remove](../capabilities/git.remote_remove.md): Remove a remote
- [git.show](../capabilities/git.show.md): One commit: its files with counts, and the hunks of one path if given (opens as a Diff tab)
- [git.status](../capabilities/git.status.md): Branch, ahead and behind counts, changed files, remotes and whether the branch is protected
- [git.sync](../capabilities/git.sync.md): Pull then push in one step (the Sync button of a mounted repository)

## Events (8)

- [git.branch_changed](../events/git.branch_changed.md): A branch was created, switched to or deleted
- [git.committed](../events/git.committed.md): A commit was made (authored by the first editor, person or agent)
- [git.initialized](../events/git.initialized.md): A folder became a git repository
- [git.protection_changed](../events/git.protection_changed.md): The protected branches of a folder changed
- [git.pulled](../events/git.pulled.md): The folder pulled from its remote
- [git.pushed](../events/git.pushed.md): The folder pushed to its remote
- [git.remote_added](../events/git.remote_added.md): A remote was added
- [git.remote_removed](../events/git.remote_removed.md): A remote was removed
