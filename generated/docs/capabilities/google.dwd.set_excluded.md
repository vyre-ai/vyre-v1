# google.dwd.set_excluded

Exclude a member from delegation, or include them again (excluded members never get a connection)

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/dwd/set_excluded |
| MCP tool | google_dwd_set_excluded (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  email: string;
  excluded: boolean;
};
```

## Output

```ts
type Out = {
  excluded: Array<string>;
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
  "input": {
    "email": "maya@example.com",
    "excluded": true
  },
  "output": {
    "excluded": [
      "maya@example.com"
    ]
  }
}
```
