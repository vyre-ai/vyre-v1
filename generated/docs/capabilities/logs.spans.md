# logs.spans

Spans of a trace or of a budget id for the speed page

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.logs |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/logs/spans |
| MCP tool | logs_spans (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  traceId?: string;
  name?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  spans: Array<{
      traceId: string;
      spanId: string;
      parent?: string;
      name: string;
      at: number;
      durUs: number;
      attrs?: Record<string, unknown>;
    }>;
  next?: string;
  total?: number;
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
  "input": {
    "cursor": "example",
    "limit": 1,
    "name": "example",
    "traceId": "0123456789abcdef0123456789abcdef"
  },
  "output": {
    "next": "example",
    "spans": [
      {
        "at": 1,
        "attrs": {},
        "durUs": 1,
        "name": "example",
        "parent": "example",
        "spanId": "example",
        "traceId": "0123456789abcdef0123456789abcdef"
      }
    ],
    "total": 1
  }
}
```
