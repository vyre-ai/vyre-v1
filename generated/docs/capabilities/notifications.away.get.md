# notifications.away.get

Am I away, until when, and who holds my approvals

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/away/get |
| MCP tool | notifications_away_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  away: boolean;
  until?: number;
  delegate?: {
    kind: "person" | "role" | "none";
    id?: string;
  };
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
  "input": {},
  "output": {
    "away": true,
    "delegate": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "until": 1760000000000
  }
}
```
