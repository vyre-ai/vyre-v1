# git.protect

Set which branches of this folder are protected (pushes to them need an approved Gate line)

| | |
|---|---|
| Module | git |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/git/protect |
| MCP tool | git_protect (files) |
| CLI | none |
| Emits | git.protection_changed |

## Input

```ts
type In = {
  folderId: string;
  branches: Array<string>;
};
```

## Output

```ts
type Out = {
  branches: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "branches": [
      "example"
    ],
    "folderId": "fld_a1b2c3"
  },
  "output": {
    "branches": [
      "example"
    ]
  }
}
```
