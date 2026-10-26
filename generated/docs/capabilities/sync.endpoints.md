# sync.endpoints

Endpoints the server advertises for this Space (direct, relay, tunnel) for the client connection manager

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/endpoints |
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
      rttMs?: number;
    }>;
  spaceKeyFingerprint: string;
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
        "kind": "direct",
        "rttMs": 1,
        "url": "wss://northwind.example.com/sync/v1/live"
      }
    ],
    "spaceKeyFingerprint": "example"
  }
}
```
