# records.page_prefs.set

Fold sections and keep fields visible for myself; a personal display choice, not a Star

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/page_prefs/set |
| MCP tool | records_page_prefs_set (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  folded?: Array<string>;
  keepVisible?: Array<string>;
};
```

## Output

```ts
type Out = {
  folded: Array<string>;
  keepVisible: Array<string>;
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
    "folded": [
      "example"
    ],
    "keepVisible": [
      "example"
    ],
    "type": "contact"
  },
  "output": {
    "folded": [
      "example"
    ],
    "keepVisible": [
      "example"
    ]
  }
}
```
