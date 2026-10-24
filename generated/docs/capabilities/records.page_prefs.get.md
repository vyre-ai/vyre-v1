# records.page_prefs.get

My choices on the record page of a type: sections I folded and fields I keep visible

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
| HTTP | POST /v1/records/page_prefs/get |
| MCP tool | records_page_prefs_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
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
