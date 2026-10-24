# settings.search

Find settings rows by words (Cmd-F)

| | |
|---|---|
| Module | settings |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/settings/search |
| MCP tool | settings_search (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      key: string;
      page: string;
      title: string;
      score: number;
    }>;
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
    "q": "example"
  },
  "output": {
    "rows": [
      {
        "key": "example",
        "page": "example",
        "score": 1,
        "title": "example"
      }
    ]
  }
}
```
