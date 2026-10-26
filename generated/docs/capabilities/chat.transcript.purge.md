# chat.transcript.purge

Remove messages and blocks older than a time from chats and channels, a batch at a time; threads listed in skipThreadIds (held ones) are left whole (retention)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/chat/transcript/purge |
| MCP tool | none |
| CLI | none |
| Emits | transcripts.purged |

## Input

```ts
type In = {
  before: number;
  limit?: number;
  skipThreadIds?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: number;
  more: boolean;
  skippedOnHold?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "before": 1760000000000,
    "idempotencyKey": "idem_1",
    "limit": 1,
    "skipThreadIds": [
      "thr_a1b2c3"
    ]
  },
  "output": {
    "more": true,
    "removed": 1,
    "skippedOnHold": 1
  }
}
```
