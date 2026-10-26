# devices.register

Host only (svc_host): create the device and session rows at sign-in; every person, admin, agent and other service is refused

| | |
|---|---|
| Module | devices |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/devices/register |
| MCP tool | none |
| CLI | none |
| Emits | device.registered, session.started |

## Input

```ts
type In = {
  person: string;
  name: string;
  class: "desktop" | "phone" | "web" | "extension" | "daemon";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  device: {
    id: string;
    person: string;
    name: string;
    class: "desktop" | "phone" | "web" | "extension" | "daemon";
    epoch: number;
    lastSeenAt?: number;
    location?: string;
    revokedAt?: number;
    current?: boolean;
  };
  sessionId: string;
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
    "class": "desktop",
    "idempotencyKey": "idem_1",
    "name": "example",
    "person": "usr_a1b2c3"
  },
  "output": {
    "device": {
      "class": "desktop",
      "current": true,
      "epoch": 1,
      "id": "dev_a1b2c3",
      "lastSeenAt": 1760000000000,
      "location": "example",
      "name": "example",
      "person": "usr_a1b2c3",
      "revokedAt": 1760000000000
    },
    "sessionId": "ses_a1b2c3"
  }
}
```
