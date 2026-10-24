# sync.hello

Handshake: cursor, epoch, registry hash and replica schema versions; answers live, update_required, resync or purge

| | |
|---|---|
| Module | sync |
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
| HTTP | POST /sync/v1/hello |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  deviceId: string;
  deviceClass: "desktop" | "phone" | "web";
  appVersion: string;
  registryHash: string;
  cursor: number;
  epoch: number;
  replica: {
    entities: Record<string, number>;
  };
};
```

## Output

```ts
type Out = {
  serverVersion: string;
  epoch: number;
  serverHlc: string;
  mode: "live" | "update_required" | "resync" | "purge";
  head: number;
  entityVersions: Record<string, number>;
};
```

## Errors

- auth.device_revoked
- auth.expired
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "appVersion": "1.0.0",
    "cursor": 1,
    "deviceClass": "desktop",
    "deviceId": "dev_a1b2c3",
    "epoch": 1,
    "registryHash": "example",
    "replica": {
      "entities": {}
    }
  },
  "output": {
    "entityVersions": {},
    "epoch": 1,
    "head": 1,
    "mode": "live",
    "serverHlc": "18f3a1b2c3d-0001-dev_a1b2c3",
    "serverVersion": "example"
  }
}
```
