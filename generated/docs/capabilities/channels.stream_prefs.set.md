# channels.stream_prefs.set

Hide or show People, Agents or Runs in one channel for myself (Hide Runs in This Channel); the header says what is hidden

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | natural |
| Offline | patch |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/channels/stream_prefs/set |
| MCP tool | channels_stream_prefs_set (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channelId: string;
  hide: Array<"people" | "agents" | "runs">;
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
    "channelId": "chn_a1b2c3",
    "hide": [
      "people"
    ]
  },
  "output": {
    "hide": [
      "people"
    ]
  }
}
```
