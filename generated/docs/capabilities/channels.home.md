# channels.home

The Space's first channel: #vyre, or an older Space's #general (legacy: Console offers to rename it). Null in a Personal Space

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/home |
| MCP tool | channels_home (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  channel: {
    channelId: string;
    name: string;
    mainThreadId: string;
    legacy: boolean;
  } | null;
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
  "input": {},
  "output": {
    "channel": {
      "channelId": "chn_a1b2c3",
      "legacy": true,
      "mainThreadId": "thr_a1b2c3",
      "name": "vyre"
    }
  }
}
```
