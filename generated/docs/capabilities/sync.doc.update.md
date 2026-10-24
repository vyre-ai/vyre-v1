# sync.doc.update

Append an accepted Yjs update from a person or agent actor (checked with authorize edit on every update)

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
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync/doc/update |
| MCP tool | none |
| CLI | none |
| Emits | doc.updated |

## Input

```ts
type In = {
  doc: string;
  update: string;
  enc?: number;
  suggest?: boolean;
};
```

## Output

```ts
type Out = {
  seq: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.revoked
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "doc": "example",
    "enc": 1,
    "suggest": true,
    "update": "example"
  },
  "output": {
    "seq": 1
  }
}
```
