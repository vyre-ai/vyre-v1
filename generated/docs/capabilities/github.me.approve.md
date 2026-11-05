# github.me.approve

Ask me before something uses my GitHub for this repository and kind of use (the Gate holds it; once I approve, it is good for ten minutes)

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | github_approval |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/me/approve |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repo: string;
  action: "read" | "push_branch" | "open_pr" | "comment" | "merge" | "push_default";
  consumer: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  approved: boolean;
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
    "action": "read",
    "consumer": "example",
    "idempotencyKey": "idem_1",
    "repo": "vyre-ai/website"
  },
  "output": {
    "approved": true
  }
}
```
