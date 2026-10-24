# sync.devices.lag

Per device cursor lag for the Console (people, device class, last seen, lag in changes)

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/devices/lag |
| MCP tool | sync_devices_lag (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  devices: Array<{
      deviceId: string;
      personId: string;
      deviceClass: "desktop" | "phone" | "web";
      cursor: number;
      lag: number;
      lastSeen: number;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "devices": [
      {
        "cursor": 1,
        "deviceClass": "desktop",
        "deviceId": "dev_a1b2c3",
        "lag": 1,
        "lastSeen": 1760000000000,
        "personId": "usr_a1b2c3"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
