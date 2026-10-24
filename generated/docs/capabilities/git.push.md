# git.push

Push the branch to the remote; a push to a protected branch raises a Gate line

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
| HTTP | POST /v1/git/push |
| MCP tool | git_push (files) |
| CLI | vyre git push |
| Emits | git.pushed |

## Input

```ts
type In = {
  folderId: string;
  remote?: string;
  branch?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  pushed: boolean;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "branch": "main",
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "remote": "origin"
  },
  "output": {
    "pushed": true,
    "sha": "9fceb02"
  }
}
```
