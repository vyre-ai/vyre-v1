# sync_types.review_schema

Accept or ignore remote schema changes; accepted ones go through schema.apply

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/review_schema |
| MCP tool | sync_types_review_schema (records) |
| CLI | none |
| Emits | sync.type_updated, schema.changed |

## Input

```ts
type In = {
  type: string;
  accept: Array<string>;
  ignore: Array<string>;
};
```

## Output

```ts
type Out = {
  accepted: number;
  ignored: number;
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
    "accept": [
      "example"
    ],
    "ignore": [
      "example"
    ],
    "type": "contact"
  },
  "output": {
    "accepted": 1,
    "ignored": 1
  }
}
```
