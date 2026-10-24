# notifications.push.register

Register this device push token for the person

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
| HTTP | POST /v1/notifications/push/register |
| MCP tool | notifications_push_register (meta) |
| CLI | none |
| Emits | notification.push_registered |

## Input

```ts
type In = {
  device: string;
  platform: "ios" | "android" | "mac" | "windows" | "web";
  token: string;
};
```

## Output

```ts
type Out = {
  registered: boolean;
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
    "device": "dev_a1b2c3",
    "platform": "ios",
    "token": "example"
  },
  "output": {
    "registered": true
  }
}
```
