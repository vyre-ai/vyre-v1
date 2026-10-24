# steps.test

Run one step in test mode with sample data: reads run for real, writes and sends are stubbed

| | |
|---|---|
| Module | steps-core |
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
| HTTP | POST /v1/steps/test |
| MCP tool | steps_test (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  input: Record<string, unknown>;
  sample?: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  output: unknown;
  stubbed: boolean;
  error?: {
    code: string;
    message: string;
  };
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
    "input": {},
    "key": "records.update",
    "sample": {}
  },
  "output": {
    "error": {
      "code": "example",
      "message": "example"
    },
    "output": {},
    "stubbed": true
  }
}
```
