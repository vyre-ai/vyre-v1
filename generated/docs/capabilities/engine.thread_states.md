# engine.thread_states

The latest turn of each of up to 200 chats in one call: running, waiting, failed or done, and for a failed one the words why; a chat the asker may not open is left out

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/thread_states |
| MCP tool | engine_thread_states (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadIds: Array<string>;
};
```

## Output

```ts
type Out = {
  states: Array<{
      threadId: string;
      state: "running" | "waiting" | "failed" | "done";
      failedLine?: string;
    }>;
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
    "threadIds": [
      "thr_a1b2c3"
    ]
  },
  "output": {
    "states": [
      {
        "failedLine": "example",
        "state": "running",
        "threadId": "thr_a1b2c3"
      }
    ]
  }
}
```
