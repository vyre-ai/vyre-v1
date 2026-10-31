# network.my_computers

The computers and servers you added: nickname, online state, what they run on, waiting ones with the fingerprint to compare

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/my_computers |
| MCP tool | network_my_computers (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  computers: Array<{
      serverId: string;
      name: string;
      state: "healthy" | "degraded" | "down";
      enrollment: "pending" | "approved";
      fingerprint?: string;
      lastSeenAt?: number;
      requestedAt?: number;
      facts?: {
        os: string;
        arch: string;
        docker: boolean;
        version: string;
      };
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
    "computers": [
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
        "requestedAt": 1760000000000,
        "serverId": "srv_a1b2c3",
        "state": "healthy"
      }
    ]
  }
}
```
