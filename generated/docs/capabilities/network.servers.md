# network.servers

Computers in the Space (the Space server and the computers that joined for compute, waiting ones included): grey rows when offline, with Reconnect and Remove

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/servers |
| MCP tool | network_servers (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  servers: Array<{
      serverId: string;
      name: string;
      state: "healthy" | "degraded" | "down";
      role: "space" | "compute";
      lastSeenAt?: number;
      enrollment?: "pending" | "approved";
      fingerprint?: string;
      owner?: string;
      facts?: {
        os: string;
        arch: string;
        docker: boolean;
        version: string;
      };
      requestedAt?: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "servers": [
      {
        "enrollment": "pending",
        "facts": {
          "arch": "example",
          "docker": true,
          "os": "example",
          "version": "example"
        },
        "fingerprint": "example",
        "lastSeenAt": 1760000000000,
        "name": "example",
        "owner": "example",
        "requestedAt": 1760000000000,
        "role": "space",
        "serverId": "srv_a1b2c3",
        "state": "healthy"
      }
    ]
  }
}
```
