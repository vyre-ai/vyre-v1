# ms.mail.subscribe

Subscribe to change notifications for a mail folder

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/mail/subscribe |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  folderId: string;
  notificationUrl: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  subscriptionId: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "folderId": "example",
    "idempotencyKey": "idem_1",
    "notificationUrl": "example"
  },
  "output": {
    "expiresAt": 1760000000000,
    "subscriptionId": "example"
  }
}
```
