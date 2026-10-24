# github.pull_request.rerun_checks

Re-run failed checks

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/pull_request/rerun_checks |
| MCP tool | github_pull_request_rerun_checks (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  number: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  requested: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "number": 1,
    "repo": "vyre-ai/website"
  },
  "output": {
    "requested": true
  }
}
```
