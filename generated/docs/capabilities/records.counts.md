# records.counts

Cached row count for a view

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/counts |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  filter?: unknown;
};
```

## Output

```ts
type Out = {
  count: number;
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
    "filter": {},
    "type": "contact"
  },
  "output": {
    "count": 1
  }
}
```
