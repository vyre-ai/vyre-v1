# google.directory.reconcile

Compare the directory with who is matched: a person gone or suspended stops, and the Space suspends them. Every page must read, and a large change waits for a person

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
| HTTP | POST /v1/google/directory/reconcile |
| MCP tool | google_directory_reconcile (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  confirmed?: boolean;
};
```

## Output

```ts
type Out = {
  checked: number;
  gone: Array<string>;
  held?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "confirmed": true
  },
  "output": {
    "checked": 1,
    "gone": [
      "maya@example.com"
    ],
    "held": "example"
  }
}
```
