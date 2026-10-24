# devices.mine

My devices and sessions in this Space (Settings > Sign-in and devices)

| | |
|---|---|
| Module | devices |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/devices/mine |
| MCP tool | devices_mine (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  devices: Array<{
      id: string;
      person: string;
      name: string;
      class: "desktop" | "phone" | "web" | "extension" | "daemon";
      epoch: number;
      lastSeenAt?: number;
      location?: string;
      revokedAt?: number;
      current?: boolean;
    }>;
  sessions: Array<{
      id: string;
      principal: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      deviceId?: string;
      kind: "device" | "agent_run";
      startedAt: number;
      lastSeenAt: number;
      location?: string;
      current?: boolean;
    }>;
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
    "devices": [
      {
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
    ],
    "sessions": [
      {
        "current": true,
        "deviceId": "dev_a1b2c3",
        "id": "ses_a1b2c3",
        "kind": "device",
        "lastSeenAt": 1760000000000,
        "location": "example",
        "principal": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "startedAt": 1760000000000
      }
    ]
  }
}
```
