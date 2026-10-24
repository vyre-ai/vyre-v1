# kits.denials

Sandbox denials with trace ids

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/denials |
| MCP tool | kits_denials (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  denials: Array<{
      at: number;
      what: string;
      traceId: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "kitId": "kit_a1b2c3",
    "limit": 1
  },
  "output": {
    "denials": [
      {
        "at": 1760000000000,
        "traceId": "0123456789abcdef0123456789abcdef",
        "what": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
