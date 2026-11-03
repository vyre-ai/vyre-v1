# network.peer_requests

New computers asking to use this Personal Space, each with the six-digit code its own screen shows

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
| HTTP | POST /v1/network/peer_requests |
| MCP tool | network_peer_requests (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  requests: Array<{
      requestId: string;
      name: string;
      platform: string;
      code: string;
      requestedAt: number;
      expiresAt: number;
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
    "requests": [
      {
        "code": "418 207",
        "expiresAt": 1760000000000,
        "name": "example",
        "platform": "example",
        "requestId": "example",
        "requestedAt": 1760000000000
      }
    ]
  }
}
```
