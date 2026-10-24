# network.public_hostnames

Public hostnames and /hooks endpoints served by this Space

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
| HTTP | POST /v1/network/public_hostnames |
| MCP tool | network_public_hostnames (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  hosts: Array<{
      host: string;
      kind: "app" | "console" | "site" | "form" | "booking" | "hook";
      certificate: "healthy" | "degraded" | "down";
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
    "hosts": [
      {
        "certificate": "healthy",
        "host": "example",
        "kind": "app"
      }
    ]
  }
}
```
