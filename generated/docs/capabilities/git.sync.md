# git.sync

Pull then push in one step (the Sync button of a mounted repository)

| | |
|---|---|
| Module | git |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | files.write |
| Grant level | use |
| Risk | high |
| Resource | folder (/folderId) |
| Gate | push_protected when git.is_protected(input.branch) |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/git/sync |
| MCP tool | git_sync (files) |
| CLI | none |
| Emits | git.pulled, git.pushed, file.version_added |

## Input

```ts
type In = {
  folderId: string;
  remote?: string;
  branch?: string;
  strategy?: "merge" | "rebase" | "ff_only";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  pulled: boolean;
  pushed: boolean;
  conflicts: Array<string>;
  sha?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "branch": "main",
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "remote": "origin",
    "strategy": "merge"
  },
  "output": {
    "conflicts": [
      "example"
    ],
    "pulled": true,
    "pushed": true,
    "sha": "9fceb02"
  }
}
```
