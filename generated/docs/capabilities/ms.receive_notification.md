# ms.receive_notification

Record a verified Graph change notification (answers the validationToken handshake) after dedupe

| | |
|---|---|
| Module | microsoft |
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
| Team Space only | no |
| HTTP | POST /v1/ms/receive_notification |
| MCP tool | none |
| CLI | none |
| Emits | microsoft.notification_received |

## Input

```ts
type In = {
  notificationId: string;
  subscriptionId: string;
  resource: string;
  changeType: "created" | "updated" | "deleted";
  clientStateOk: boolean;
  tenantId?: string;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
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
    "changeType": "created",
    "clientStateOk": true,
    "notificationId": "example",
    "resource": "example",
    "subscriptionId": "example",
    "tenantId": "example"
  },
  "output": {
    "accepted": true
  }
}
```
