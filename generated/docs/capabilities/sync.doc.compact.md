# sync.doc.compact

Fold updates into a snapshot with the Markdown projection (every 500 updates or 10 minutes); E2E documents are compacted by the owner device

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/doc/compact |
| MCP tool | none |
| CLI | none |
| Emits | doc.compacted |

## Input

```ts
type In = {
  doc: string;
  upto?: number;
  snapshot?: string;
  md?: string;
};
```

## Output

```ts
type Out = {
  upto: number;
  bytes: number;
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
  "input": {
    "doc": "example",
    "md": "example",
    "snapshot": "example",
    "upto": 1
  },
  "output": {
    "bytes": 1,
    "upto": 1
  }
}
```
