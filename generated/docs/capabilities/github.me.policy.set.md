# github.me.policy.set

Change what I let a kind of use do: read, push a branch, open a pull request, comment, merge, push to the default branch

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/github/me/policy/set |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  policy: {
    read?: "always" | "ask" | "never";
    push_branch?: "always" | "ask" | "never";
    open_pr?: "always" | "ask" | "never";
    comment?: "always" | "ask" | "never";
    merge?: "always" | "ask" | "never";
    push_default?: "always" | "ask" | "never";
  };
};
```

## Output

```ts
type Out = {
  policy: {
    read: "always" | "ask" | "never";
    push_branch: "always" | "ask" | "never";
    open_pr: "always" | "ask" | "never";
    comment: "always" | "ask" | "never";
    merge: "always" | "ask" | "never";
    push_default: "always" | "ask" | "never";
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
    "policy": {
      "comment": "always",
      "merge": "always",
      "open_pr": "always",
      "push_branch": "always",
      "push_default": "always",
      "read": "always"
    }
  },
  "output": {
    "policy": {
      "comment": "always",
      "merge": "always",
      "open_pr": "always",
      "push_branch": "always",
      "push_default": "always",
      "read": "always"
    }
  }
}
```
