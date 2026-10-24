# network.status

Address, certificate state, relay state and public ingress

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.network |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/status |
| MCP tool | network_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  address: string;
  mode: "own_domain" | "relay";
  certificate: {
    host: string;
    expiresAt?: number;
    state: "healthy" | "degraded" | "down";
  };
  publicIngress: boolean;
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
    "address": "example",
    "certificate": {
      "expiresAt": 1760000000000,
      "host": "example",
      "state": "healthy"
    },
    "mode": "own_domain",
    "publicIngress": true
  }
}
```
