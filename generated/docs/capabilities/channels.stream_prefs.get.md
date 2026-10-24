# channels.stream_prefs.get

My People, Agents and Runs choice for one channel

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/stream_prefs/get |
| MCP tool | channels_stream_prefs_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channelId: string;
};
```

## Output

```ts
type Out = {
  hide: Array<"people" | "agents" | "runs">;
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
    "channelId": "chn_a1b2c3"
  },
  "output": {
    "hide": [
      "people"
    ]
  }
}
```
