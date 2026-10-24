# home.mark_digest_seen

Mark the digest seen so it resets

| | |
|---|---|
| Module | home |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/home/mark_digest_seen |
| MCP tool | home_mark_digest_seen (meta) |
| CLI | none |
| Emits | digest.seen |

## Input

```ts
type In = {
  digestId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "digestId": "dgs_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
