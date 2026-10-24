# automations.followers.add

Follow an Automation to get its updates

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/followers/add |
| MCP tool | automations_followers_add (automations) |
| CLI | none |
| Emits | automation.follower_added |

## Input

```ts
type In = {
  automationId: string;
  follower: string;
};
```

## Output

```ts
type Out = {
  followers: Array<string>;
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
    "automationId": "aut_a1b2c3",
    "follower": "usr_a1b2c3"
  },
  "output": {
    "followers": [
      "example"
    ]
  }
}
```
