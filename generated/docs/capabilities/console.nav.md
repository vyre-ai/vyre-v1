# console.nav

Console navigation pruned by what the caller may open (pages hide by permission)

| | |
|---|---|
| Module | console-views |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/nav |
| MCP tool | console_nav (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  groups: Array<{
      key: string;
      title: string;
      pages: Array<{
          key: string;
          title: string;
        }>;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "groups": [
      {
        "key": "example",
        "pages": [
          {
            "key": "example",
            "title": "example"
          }
        ],
        "title": "example"
      }
    ]
  }
}
```
