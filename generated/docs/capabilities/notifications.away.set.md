# notifications.away.set

Set myself away until a time; approvals go to a person, a role or no one; only calls interrupt

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
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/away/set |
| MCP tool | notifications_away_set (meta) |
| CLI | vyre away set |
| Emits | away.set |

## Input

```ts
type In = {
  until: number;
  delegate: {
    kind: "person" | "role" | "none";
    id?: string;
  };
};
```

## Output

```ts
type Out = {
  until: number;
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
    "delegate": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "until": 1760000000000
  },
  "output": {
    "until": 1760000000000
  }
}
```
