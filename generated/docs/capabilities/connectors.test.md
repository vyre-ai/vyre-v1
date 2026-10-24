# connectors.test

Run the harness on recorded responses and report each case

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/test |
| MCP tool | connectors_test (engineer) |
| CLI | vyre connector test |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  draftId?: string;
};
```

## Output

```ts
type Out = {
  result: {
    passed: number;
    failed: number;
    cases: Array<{
        name: string;
        ok: boolean;
        message?: string;
      }>;
  };
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
    "draftId": "cdr_a1b2c3",
    "key": "hubspot"
  },
  "output": {
    "result": {
      "cases": [
        {
          "message": "example",
          "name": "example",
          "ok": true
        }
      ],
      "failed": 1,
      "passed": 1
    }
  }
}
```
