# kits.test_run

Run the Kit tests against the seeded fixture Space

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.publish |
| Grant level | edit |
| Risk | medium |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/test_run |
| MCP tool | kits_test_run (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
};
```

## Output

```ts
type Out = {
  passed: boolean;
  failures: Array<{
      test: string;
      message: string;
    }>;
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
    "kitId": "kit_a1b2c3"
  },
  "output": {
    "failures": [
      {
        "message": "example",
        "test": "example"
      }
    ],
    "passed": true
  }
}
```
