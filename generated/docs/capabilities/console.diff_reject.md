# console.diff_reject

Reject a proposed change

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | console.access |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/diff_reject |
| MCP tool | console_diff_reject (engineer) |
| CLI | none |
| Emits | console.change_rejected |

## Input

```ts
type In = {
  diffId: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  rejected: boolean;
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
    "diffId": "dif_a1b2c3",
    "note": "example"
  },
  "output": {
    "rejected": true
  }
}
```
