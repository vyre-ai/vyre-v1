# campaigns.unsubscribe

Inbound: handle an unsubscribe link; writes the Suppression list

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /hooks/unsubscribe |
| MCP tool | none |
| CLI | none |
| Emits | campaign.unsubscribed |

## Input

```ts
type In = {
  token: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "token": "example"
  },
  "output": {
    "ok": true
  }
}
```
