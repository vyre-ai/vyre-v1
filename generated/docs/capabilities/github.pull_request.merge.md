# github.pull_request.merge

Merge a pull request (protected branches go through the Gate)

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | push_protected |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/pull_request/merge |
| MCP tool | github_pull_request_merge (records, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  number: number;
  method: "merge" | "squash" | "rebase";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  merged: boolean;
  sha?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "method": "merge",
    "number": 1,
    "repo": "vyre-ai/website"
  },
  "output": {
    "merged": true,
    "sha": "example"
  }
}
```
