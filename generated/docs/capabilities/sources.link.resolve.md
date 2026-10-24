# sources.link.resolve

Settle an unsure match: link to a candidate, create a new record, or ignore

| | |
|---|---|
| Module | sources |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sources/link/resolve |
| MCP tool | sources_link_resolve (records) |
| CLI | none |
| Emits | source.linked |

## Input

```ts
type In = {
  matchId: string;
  recordId?: string;
  createNew?: boolean;
  ignore?: boolean;
};
```

## Output

```ts
type Out = {
  recordId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "createNew": true,
    "ignore": true,
    "matchId": "mat_a1b2c3",
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "recordId": "rec_a1b2c3"
  }
}
```
