# github.session_env

For one turn of Claude Code, Codex or Grok: GH_TOKEN and GITHUB_TOKEN as filler handles and a git credential helper, scoped to the owner's repositories the person lets run without asking

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/session_env |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  repos: Array<string>;
  consumer: string;
};
```

## Output

```ts
type Out = {
  env: Record<string, string>;
  gitConfig: Array<string>;
  repos: Array<string>;
  skipped: Array<string>;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "consumer": "example",
    "repos": [
      "vyre-ai/website"
    ]
  },
  "output": {
    "env": {},
    "expiresAt": 1760000000000,
    "gitConfig": [
      "example"
    ],
    "repos": [
      "vyre-ai/website"
    ],
    "skipped": [
      "vyre-ai/website"
    ]
  }
}
```
