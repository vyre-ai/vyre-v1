# devices.rename

Rename one of my devices

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
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/devices/rename |
| MCP tool | devices_rename (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  deviceId: string;
  name: string;
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
    "deviceId": "dev_a1b2c3",
    "name": "example"
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
    }
  }
}
```
