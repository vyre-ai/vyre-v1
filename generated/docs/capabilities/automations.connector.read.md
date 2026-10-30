# automations.connector.read

Run a connector action that only reads, as a step does. The action must be tested. The Vault fills the key. The reply is the app's answer.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/connector/read |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  input?: Record<string, unknown>;
  dryRun?: boolean;
};
```

## Output

```ts
type Out = {
  output: unknown;
  status: number;
  dryRun: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.rate_limited
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "dryRun": true,
    "input": {},
    "key": "example"
  },
  "output": {
    "dryRun": true,
    "output": {},
    "status": 1
  }
}
```
