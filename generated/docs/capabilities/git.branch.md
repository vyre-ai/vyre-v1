# git.branch

Create, switch to or delete a branch

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
| HTTP | POST /v1/git/branch |
| MCP tool | git_branch (files) |
| CLI | vyre git branch |
| Emits | git.branch_changed |

## Input

```ts
type In = {
  folderId: string;
  action: "create" | "switch" | "delete";
  name: string;
  from?: string;
};
```

## Output

```ts
type Out = {
  branch: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "create",
    "folderId": "fld_a1b2c3",
    "from": "example",
    "name": "main"
  },
  "output": {
    "branch": "main"
  }
}
```
