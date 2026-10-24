# computers.files.delete

Delete a file from the agent Files folder; always asks outside work/

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | high |
| Resource | computer (/computerId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/files/delete |
| MCP tool | computer_files_delete (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  path: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "path": "example"
  },
  "output": {
    "ok": true
  }
}
```
