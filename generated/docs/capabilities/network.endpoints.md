# network.endpoints

Endpoint list for the connection manager: direct, relay and tunnel with health and round trip time

| | |
|---|---|
| Module | network |
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
| HTTP | POST /v1/network/endpoints |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  endpoints: Array<{
      kind: "direct" | "relay" | "tunnel";
      url: string;
      health: "healthy" | "degraded" | "down";
      rttMs?: number;
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
    "endpoints": [
      {
        "health": "healthy",
        "kind": "direct",
        "rttMs": 1,
        "url": "https://northwind.example.com"
      }
    ]
  }
}
```
