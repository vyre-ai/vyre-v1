# computers.chrome.send

Send a held send, post or payment: the person approves it first (Gate)

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | computers.use |
| Grant level | use |
| Risk | high |
| Resource | computer (/computerId) |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/computers/chrome/send |
| MCP tool | chrome_send (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  heldId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sent: boolean;
  taskId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
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
    "heldId": "example",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "sent": true,
    "taskId": "tsk_a1b2c3"
  }
}
```
