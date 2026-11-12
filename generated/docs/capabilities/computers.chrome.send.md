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
| Team Space only | no |
| HTTP | POST /v1/computers/chrome/send |
| MCP tool | chrome_send (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  inMyChrome?: boolean;
  heldId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sent: boolean;
  taskId?: string;
  downloads?: Array<{
      name: string;
      path: string;
      fileId?: string;
      note?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
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
    "idempotencyKey": "idem_1",
    "inMyChrome": true
  },
  "output": {
    "downloads": [
      {
        "fileId": "fil_a1b2c3",
        "name": "example",
        "note": "example",
        "path": "Downloads/report.pdf"
      }
    ],
    "sent": true,
    "taskId": "tsk_a1b2c3"
  }
}
```
