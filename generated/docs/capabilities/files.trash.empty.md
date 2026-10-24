# files.trash.empty

Delete everything in Trash that the caller may delete

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.delete |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/trash/empty |
| MCP tool | files_trash_empty (files) |
| CLI | none |
| Emits | file.purged |

## Input

```ts
type In = {
  olderThanDays?: number;
};
```

## Output

```ts
type Out = {
  purged: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "olderThanDays": 1
  },
  "output": {
    "purged": 1
  }
}
```
