# spaces.delete

Owner only: delete the Space after typing its legal name

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/delete |
| MCP tool | spaces_delete (meta) |
| CLI | none |
| Emits | space.deleted |

## Input

```ts
type In = {
  confirmName: string;
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
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "confirmName": "example"
  },
  "output": {
    "ok": true
  }
}
```
