# changesets.review_externally

Open a changeset to an outside agent (Claude Code, Codex) with a read and comment token; returns a one-time review link (the token is in the link, shown once, never logged)

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/changesets/review_externally |
| MCP tool | changesets_review_externally (files) |
| CLI | none |
| Emits | changeset.sent_for_review |

## Input

```ts
type In = {
  changesetId: string;
  actorId?: string;
};
```

## Output

```ts
type Out = {
  actorId: string;
  reviewUrl: string;
  expiresAt: number;
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
    "actorId": "act_a1b2c3",
    "changesetId": "chg_a1b2c3"
  },
  "output": {
    "actorId": "act_a1b2c3",
    "expiresAt": 1760000000000,
    "reviewUrl": "https://northwind.example.com/review/cs_example?token=otk_example"
  }
}
```
