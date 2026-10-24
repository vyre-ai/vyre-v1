# git.pull

Pull from the remote with a merge, rebase or fast-forward; conflicts are listed, not hidden

| | |
|---|---|
| Module | git |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/git/pull |
| MCP tool | git_pull (files) |
| CLI | vyre git pull |
| Emits | git.pulled, file.version_added |

## Input

```ts
type In = {
  folderId: string;
  remote?: string;
  branch?: string;
  strategy?: "merge" | "rebase" | "ff_only";
};
```

## Output

```ts
type Out = {
  updated: boolean;
  sha?: string;
  conflicts: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "branch": "main",
    "folderId": "fld_a1b2c3",
    "remote": "origin",
    "strategy": "merge"
  },
  "output": {
    "conflicts": [
      "example"
    ],
    "sha": "9fceb02",
    "updated": true
  }
}
```
