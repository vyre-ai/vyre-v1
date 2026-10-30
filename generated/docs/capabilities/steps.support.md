# steps.support

Which live steps this server can run (Run code needs a sandbox; the AI step needs the agent runtime), with the reason when one cannot

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
| HTTP | POST /v1/steps/support |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  code: {
    available: boolean;
    reason?: string;
  };
  ai: {
    available: boolean;
    reason?: string;
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
  "input": {},
  "output": {
    "ai": {
      "available": true,
      "reason": "example"
    },
    "code": {
      "available": true,
      "reason": "example"
    }
  }
}
```
