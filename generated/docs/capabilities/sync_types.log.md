# sync_types.log

Sync log: runs, pulls and pushes under one trace id each

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/log |
| MCP tool | sync_types_log (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      at: number;
      kind: "pull" | "push" | "conflict" | "error" | "schema";
      summary: string;
      runId?: string;
      traceId?: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "type": "contact"
  },
  "output": {
    "entries": [
      {
        "at": 1760000000000,
        "kind": "pull",
        "runId": "run_a1b2c3",
        "summary": "example",
        "traceId": "0123456789abcdef0123456789abcdef"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
