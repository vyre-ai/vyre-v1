# skills.mine.remove

Remove one of your skills (and its shares), or take a shared one off your list

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/skills/mine/remove |
| MCP tool | skills_mine_remove (agents) |
| CLI | none |
| Emits | skill.mine_changed, skill.share_decided |

## Input

```ts
type In = {
  skillId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "idempotencyKey": "idem_1",
    "skillId": "sko_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
