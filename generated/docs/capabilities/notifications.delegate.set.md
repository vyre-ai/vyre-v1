# notifications.delegate.set

Set my standing approvals delegate chain; a delegate never gains access

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/delegate/set |
| MCP tool | notifications_delegate_set (meta) |
| CLI | none |
| Emits | notification.delegate_changed |

## Input

```ts
type In = {
  chain: Array<{
      kind: "person" | "role" | "none";
      id?: string;
    }>;
};
```

## Output

```ts
type Out = {
  chain: Array<{
      kind: "person" | "role" | "none";
      id?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "chain": [
      {
        "id": "usr_a1b2c3",
        "kind": "person"
      }
    ]
  },
  "output": {
    "chain": [
      {
        "id": "usr_a1b2c3",
        "kind": "person"
      }
    ]
  }
}
```
