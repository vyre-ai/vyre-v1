# notifications.away.clear

I'm Back: end away and return what waited

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
| HTTP | POST /v1/notifications/away/clear |
| MCP tool | notifications_away_clear (meta) |
| CLI | vyre away clear |
| Emits | away.cleared |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  waitedApprovals: number;
  waitedDigest: number;
  digestId?: string;
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
    "digestId": "dgs_a1b2c3",
    "waitedApprovals": 1,
    "waitedDigest": 1
  }
}
```
