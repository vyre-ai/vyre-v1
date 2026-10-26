# sync.doc.close

Close a document session: writes a named history version when the content changed since the last one

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/doc/close |
| MCP tool | none |
| CLI | none |
| Emits | doc.compacted |

## Input

```ts
type In = {
  doc: string;
  name?: string;
};
```

## Output

```ts
type Out = {
  versioned: boolean;
  upto: number;
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
    "name": "example"
  },
  "output": {
    "upto": 1,
    "versioned": true
  }
}
```
