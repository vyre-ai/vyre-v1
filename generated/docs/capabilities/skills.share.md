# skills.share

Share one of your skills with chosen people in this Space, or with everyone here. Each of them gets a card and decides

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
| HTTP | POST /v1/skills/share |
| MCP tool | skills_share (agents) |
| CLI | none |
| Emits | skill.shared |

## Input

```ts
type In = {
  skillId: string;
  to?: Array<string>;
  space?: boolean;
  stop?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sharedWith: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "skillId": "sko_a1b2c3",
    "space": true,
    "stop": true,
    "to": [
      "usr_a1b2c3"
    ]
  },
  "output": {
    "sharedWith": [
      "example"
    ]
  }
}
```
