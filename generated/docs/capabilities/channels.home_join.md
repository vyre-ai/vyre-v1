# channels.home_join

System: the join step that puts a new member in the Space's first channel, making #vyre when the Space has none

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/home_join |
| MCP tool | none |
| CLI | none |
| Emits | channel.created, thread.started, channel.member_added |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  channelId: string | null;
  added: boolean;
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
    "personId": "usr_a1b2c3"
  },
  "output": {
    "added": true,
    "channelId": "chn_a1b2c3"
  }
}
```
